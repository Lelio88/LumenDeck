/**
 * Moteur d'execution des scenarios, independant du reseau et de l'horloge.
 *
 * Ce que fait ce module : derouler dans le temps les images produites par un
 * scenario, en les appliquant aux ampoules, et garantir qu'on sait TOUJOURS
 * l'arreter et remettre les lampes comme on les a trouvees.
 *
 * L'acces aux ampoules (`withBulb`), les minuteries et l'horloge sont INJECTES :
 * runner.ts branche le vrai pilote, les tests de fausses lampes et une horloge
 * qu'ils avancent a la main. C'est ce qui permet de verifier qu'un scenario
 * achete par un viewer s'arrete bien a l'heure et rend les lampes dans leur
 * etat d'avant, sans ampoule ni attente reelle.
 *
 * Choix non evidents :
 *
 *   - Une seule execution par ampoule. Deux touches qui lanceraient un scenario
 *     sur la meme lampe se battraient image par image. Demarrer un scenario
 *     arrete donc d'abord celui qui occupait l'une de ses lampes.
 *
 *   - Minuterie rearmee a chaque image plutot qu'un intervalle : les durees
 *     varient d'une image a l'autre (une bougie ne vacille pas en cadence), et
 *     un intervalle empilerait des tours pendant un aller-retour reseau.
 *
 *   - L'etat de chaque lampe est releve AVANT la premiere image et restaure a
 *     l'arret. Un scenario est un emprunt, pas une reconfiguration.
 *
 *   - `start` rend VRAI seulement si la premiere image a atteint au moins une
 *     lampe : un rachat de viewer s'en sert pour rembourser un scenario qui
 *     n'a rien montre.
 *
 * Invariant a preserver : aucun chemin de sortie ne doit laisser une minuterie
 * armee. C'est pourquoi l'arret est idempotent et pourquoi le drapeau `stopped`
 * est teste apres CHAQUE attente — une image en vol peut se terminer apres que
 * l'utilisateur a demande l'arret.
 *
 * Usage canonique :
 *   const engine = createEngine({ withBulb: withRetry, timers, now: Date.now });
 *   await engine.start(byId('gyrophare'), [coordsA, coordsB], { together: true });
 */
import type { LightDriver, LightState } from '../driver/types.ts';
import { MIN_HOLD_MS, frameFor, type Cue, type Scenario } from './catalogue.ts';
import { createRegistry } from './sessions.ts';

/** Coordonnees d'une ampoule, telles que les rend `coordinatesForMany`. */
export type Target = { id: string; key: string; ip?: string; version?: string };

/** Comment jouer : ensemble ou chacune dans son coin, et combien de temps au plus. */
export type StartOptions = {
  /** Les lampes jouent la version de groupe du scenario (voir catalogue.ts). */
  readonly together?: boolean;
  /**
   * Duree maximale, en millisecondes. Passe ce delai, le scenario s'arrete et
   * les lampes reviennent a leur etat d'avant. Absente : jusqu'a l'arret.
   * Sert aux scenarios lances par un viewer, dont la duree depend du prix paye.
   */
  readonly maxMs?: number;
};

export type EngineDeps = {
  /** Execute une operation sur une ampoule (le pilote reel : `withRetry`). Leve si elle est injoignable. */
  readonly withBulb: <T>(target: Target, op: (bulb: LightDriver) => Promise<T>) => Promise<T>;
  readonly timers: {
    set(callback: () => void, ms: number): unknown;
    clear(handle: unknown): void;
  };
  readonly now: () => number;
};

export type Engine = {
  /** Lance un scenario ; rend vrai s'il joue vraiment (voir l'en-tete). */
  start(scenario: Scenario, targets: readonly Target[], options?: StartOptions): Promise<boolean>;
  /** Arrete le scenario qui occupe cette ampoule et restaure ses lampes. Idempotent. */
  stop(bulbId: string | undefined): Promise<void>;
  /** Arrete tout. Appele a l'extinction du plugin. */
  stopAll(): Promise<void>;
  /** Le scenario en cours sur cette ampoule, principale ou non, ou undefined. */
  runningOn(bulbId: string | undefined): string | undefined;
  /**
   * Se termine quand le scenario qui occupe cette ampoule s'arrete, lampes
   * restaurees ; tout de suite si rien ne tourne. Sert a faire attendre la fin
   * d'un scenario achete par un viewer avant de servir le suivant.
   */
  untilStopped(bulbId: string | undefined): Promise<void>;
};

type Session = {
  readonly scenarioId: string;
  readonly together: boolean;
  /** Instant (ms) ou le scenario doit s'arreter de lui-meme, ou undefined. */
  readonly deadline: number | undefined;
  timer: unknown;
  stopped: boolean;
  /** Etat releve au demarrage, par ampoule. Absent si la lecture a echoue. */
  readonly snapshots: Map<string, LightState>;
  readonly targets: readonly Target[];
  /** Echecs reseau consecutifs. Au-dela de TOLERANCE, on renonce. */
  failures: number;
  /** Se termine a l'arret, une fois les lampes restaurees. */
  readonly ended: Promise<void>;
  /** Termine `ended`. */
  readonly markEnded: () => void;
};

/**
 * Nombre d'images ratees d'affilee avant d'abandonner.
 *
 * Une ampoule qu'on debranche en pleine execution ferait sinon tourner la
 * minuterie indefiniment, a raison d'un aller-retour rate toutes les 300 ms.
 */
const TOLERANCE = 3;

export function createEngine(deps: EngineDeps): Engine {
  const { withBulb, timers, now } = deps;
  /** Executions en cours, retrouvables depuis chacune de leurs ampoules (voir sessions.ts). */
  const sessions = createRegistry<Session>();

  /** Applique une consigne a une ampoule. */
  async function applyCue(target: Target, cue: Cue): Promise<void> {
    await withBulb(target, async (bulb) => {
      if (cue.on === false) {
        await bulb.setPower(false);
        return;
      }
      // Une couleur implique d'allumer : appliquer une teinte a une lampe eteinte
      // est silencieux, et le scenario paraitrait casse.
      if (cue.on === true || cue.color) await bulb.setPower(true);
      if (cue.color) await bulb.setColor(cue.color);
      if (cue.brightness !== undefined) await bulb.setBrightness(cue.brightness);
    });
  }

  /**
   * Repartit les consignes d'une image sur les ampoules.
   *
   * Le nombre d'ampoules commande, pas le nombre de roles : avec une seule lampe,
   * un gyrophare a deux roles ne joue que le premier ; avec plus de lampes que
   * de consignes, les lampes en trop recoivent la derniere.
   *
   * Les lampes obeissent INDEPENDAMMENT : une lampe debranchee ne doit pas
   * arreter l'animation des autres. Rend vrai si au moins une a repondu.
   */
  async function applyFrame(cues: readonly Cue[], targets: readonly Target[]): Promise<boolean> {
    const settled = await Promise.allSettled(targets.map((target, index) => {
      const cue = cues[Math.min(index, cues.length - 1)];
      return cue ? applyCue(target, cue) : Promise.resolve();
    }));
    return settled.some((result) => result.status === 'fulfilled');
  }

  /** Remet une lampe dans l'etat releve au demarrage. */
  async function restore(target: Target, state: LightState): Promise<void> {
    await withBulb(target, async (bulb) => {
      if (!state.on) {
        await bulb.setPower(false);
        return;
      }
      await bulb.setPower(true);
      if (state.color) await bulb.setColor(state.color);
      else if (state.temperatureK !== null) await bulb.setTemperature(state.temperatureK);
      await bulb.setBrightness(state.brightness);
    });
  }

  /** Deroule une image puis programme la suivante. Rend vrai si l'image a atteint au moins une lampe. */
  async function tick(session: Session, scenario: Scenario, step: number): Promise<boolean> {
    if (session.stopped) return false;
    if (session.deadline !== undefined && now() >= session.deadline) {
      await stopSession(session);
      return false;
    }

    const frame = frameFor(scenario, step, session.targets.length, session.together);
    const reached = await applyFrame(frame.cues, session.targets);
    if (reached) {
      session.failures = 0;
    } else {
      session.failures += 1;
      if (session.failures >= TOLERANCE) {
        await stopSession(session);
        return false;
      }
    }

    // Relire APRES l'attente reseau : l'utilisateur a pu demander l'arret pendant
    // que l'image partait.
    if (session.stopped) return reached;

    const next = step + 1;
    if (!scenario.loops && scenario.steps !== undefined && next >= scenario.steps) {
      await stopSession(session);
      return reached;
    }

    // Une image longue (5 s au lever du soleil) ne doit pas faire depasser l'echeance.
    const hold = Math.max(MIN_HOLD_MS, frame.holdMs);
    const left = session.deadline === undefined ? hold : Math.max(0, session.deadline - now());
    session.timer = timers.set(() => { session.timer = undefined; void tick(session, scenario, next); }, Math.min(hold, left));
    return reached;
  }

  /** La session qui occupe l'une de ces lampes, ou undefined. */
  function occupant(targets: readonly Target[]): Session | undefined {
    for (const target of targets) {
      const session = sessions.get(target.id);
      if (session) return session;
    }
    return undefined;
  }

  /**
   * Arrete CETTE session, pas celle qui occupe aujourd'hui la meme lampe.
   *
   * Par identite plutot que par identifiant d'ampoule : une image en vol qui
   * echoue pour la troisieme fois peut arriver apres que la session a ete
   * remplacee, et un arret par identifiant arreterait alors la nouvelle.
   */
  async function stopSession(session: Session): Promise<void> {
    if (session.stopped) return;

    sessions.remove(session);
    session.stopped = true;
    if (session.timer !== undefined) timers.clear(session.timer);
    session.timer = undefined;

    await Promise.all(session.targets.map(async (target) => {
      const snapshot = session.snapshots.get(target.id);
      if (!snapshot) return;
      try {
        await restore(target, snapshot);
      } catch {
        // Une lampe qu'on ne peut plus joindre ne sera pas restauree ; insister
        // bloquerait l'arret, qui doit rester immediat pour l'utilisateur.
      }
    }));
    session.markEnded();
  }

  return {
    async start(scenario, targets, options = {}) {
      if (targets.length === 0) return false;

      // Liberer TOUTES les lampes avant de les reprendre. On reboucle tant qu'une
      // lampe est occupee : un autre demarrage a pu s'inscrire pendant qu'on
      // attendait une restauration.
      for (let busy = occupant(targets); busy; busy = occupant(targets)) await stopSession(busy);

      let markEnded!: () => void;
      const ended = new Promise<void>((resolve) => { markEnded = resolve; });
      const session: Session = {
        ended,
        markEnded,
        scenarioId: scenario.id,
        together: options.together === true,
        deadline: options.maxMs === undefined ? undefined : now() + options.maxMs,
        timer: undefined,
        stopped: false,
        snapshots: new Map(),
        targets,
        failures: 0,
      };

      // S'inscrire TOUT DE SUITE, avant la moindre attente reseau : la lecture
      // d'une lampe debranchee dure ~5 s, et tant que la session n'est pas
      // indexee un second appui lancerait une seconde session impossible a arreter.
      sessions.add(session);

      // Relever l'etat avant la premiere image. Un echec de lecture n'empeche
      // pas de jouer : on renonce seulement a restaurer CETTE lampe.
      await Promise.all(targets.map(async (target) => {
        try {
          session.snapshots.set(target.id, await withBulb(target, (bulb) => bulb.read()));
        } catch {
          // Injoignable a la lecture : elle le sera sans doute a l'ecriture, et
          // la tolerance aux echecs se chargera d'arreter proprement.
        }
      }));

      // Un arret pendant le releve : rien n'a ete joue, rien a restaurer.
      if (session.stopped) return false;
      return tick(session, scenario, 0);
    },

    async stop(bulbId) {
      const session = bulbId ? sessions.get(bulbId) : undefined;
      if (session) await stopSession(session);
    },

    async stopAll() {
      await Promise.all(sessions.unique().map(stopSession));
    },

    runningOn(bulbId) {
      return bulbId ? sessions.get(bulbId)?.scenarioId : undefined;
    },

    untilStopped(bulbId) {
      const session = bulbId ? sessions.get(bulbId) : undefined;
      return session ? session.ended : Promise.resolve();
    },
  };
}
