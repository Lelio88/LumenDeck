/**
 * Moteur d'execution des scenarios.
 *
 * Ce que fait ce module : derouler dans le temps les images produites par un
 * scenario, en les appliquant aux ampoules, et garantir qu'on sait TOUJOURS
 * l'arreter et remettre les lampes comme on les a trouvees.
 *
 * Choix non evidents :
 *
 *   - Une seule execution par ampoule, indexee sur son identifiant. Deux touches
 *     qui lanceraient un scenario sur la meme lampe se battraient image par
 *     image, avec un resultat illisible et impossible a diagnostiquer. Demarrer
 *     un scenario arrete donc silencieusement celui qui occupait la lampe.
 *
 *   - `setTimeout` rearme a chaque image plutot que `setInterval`. Les durees
 *     varient d'une image a l'autre (une bougie ne vacille pas en cadence), et
 *     surtout un `setInterval` continuerait d'empiler des tours pendant qu'un
 *     aller-retour reseau est en cours.
 *
 *   - L'etat de chaque lampe est releve AVANT la premiere image et restaure a
 *     l'arret. Un scenario est un emprunt, pas une reconfiguration : l'utilisateur
 *     doit retrouver son eclairage, pas le rouge du dernier eclat.
 *
 * Invariant a preserver : aucun chemin de sortie ne doit laisser un minuteur
 * arme. C'est pourquoi `stop` est idempotent et pourquoi le drapeau `stopped`
 * est teste apres CHAQUE attente — une image en vol peut se terminer apres que
 * l'utilisateur a demande l'arret.
 *
 * Usage canonique :
 *   await start(byId('gyrophare'), [coordsA, coordsB]);
 *   await stop(coordsA.id);
 */
import { withRetry } from '../driver/pool.js';
import type { LightDriver, LightState } from '../driver/types.js';
import { MIN_HOLD_MS, frameFor, type Cue, type Scenario } from './catalogue.js';
import { createRegistry } from './sessions.js';

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

type Session = {
  readonly scenarioId: string;
  readonly together: boolean;
  /** Instant (ms) ou le scenario doit s'arreter de lui-meme, ou undefined. */
  readonly deadline: number | undefined;
  timer: ReturnType<typeof setTimeout> | undefined;
  stopped: boolean;
  /** Etat releve au demarrage, par ampoule. Vide si la lecture a echoue. */
  readonly snapshots: Map<string, LightState>;
  readonly targets: readonly Target[];
  /** Echecs reseau consecutifs. Au-dela de TOLERANCE, on renonce. */
  failures: number;
};

/**
 * Nombre d'images ratees d'affilee avant d'abandonner.
 *
 * Une ampoule qu'on debranche en pleine execution ferait sinon tourner le
 * minuteur indefiniment, a raison d'un aller-retour rate toutes les 300 ms.
 */
const TOLERANCE = 3;

/** Executions en cours, retrouvables depuis chacune de leurs ampoules (voir sessions.ts). */
const sessions = createRegistry<Session>();

/** Le scenario en cours sur cette ampoule, principale ou non, ou undefined. */
export function runningOn(bulbId: string | undefined): string | undefined {
  return bulbId ? sessions.get(bulbId)?.scenarioId : undefined;
}

/** Applique une consigne a une ampoule. */
async function applyCue(target: Target, cue: Cue): Promise<void> {
  await withRetry(target, async (bulb: LightDriver) => {
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
 * Repartit les consignes d'une image sur les ampoules disponibles.
 *
 * Le nombre d'ampoules commande, pas le nombre de roles : avec une seule lampe,
 * un gyrophare a deux roles ne joue que le premier, ce qui donne une alternance
 * rouge/bleu au lieu d'un scenario muet. Avec deux lampes et une seule consigne,
 * les deux recoivent la meme.
 *
 * Les lampes obeissent INDEPENDAMMENT : une lampe debranchee dans le groupe ne
 * doit pas arreter l'animation des autres. Rend vrai si au moins une a repondu ;
 * c'est seulement quand AUCUNE ne repond que l'image compte comme un echec.
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
  await withRetry(target, async (bulb: LightDriver) => {
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
  if (session.deadline !== undefined && Date.now() >= session.deadline) {
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
  const left = session.deadline === undefined ? hold : Math.max(MIN_HOLD_MS, session.deadline - Date.now());
  session.timer = setTimeout(() => void tick(session, scenario, next), Math.min(hold, left));
  return reached;
}

/**
 * Lance un scenario sur une ou plusieurs ampoules.
 *
 * La premiere ampoule de la liste est la principale : elle porte le premier
 * role. Toute ampoule du groupe permet de savoir si un scenario tourne et de
 * l'arreter.
 */
/**
 * Rend vrai si le scenario joue VRAIMENT : sa premiere image a atteint au moins
 * une lampe, et personne ne l'a arrete pendant le releve d'etat. Une touche peut
 * l'ignorer ; un rachat de viewer s'en sert pour rembourser plutot que d'encaisser
 * un scenario qui n'a rien montre.
 */
export async function start(scenario: Scenario, targets: readonly Target[], options: StartOptions = {}): Promise<boolean> {
  if (targets.length === 0) return false;

  // Liberer TOUTES les lampes avant de les reprendre, sinon deux scenarios se
  // disputeraient les memes images. On reboucle tant qu'une lampe est occupee :
  // un autre demarrage a pu s'inscrire pendant qu'on attendait une restauration.
  for (let busy = occupant(targets); busy; busy = occupant(targets)) await stopSession(busy);

  const session: Session = {
    scenarioId: scenario.id,
    together: options.together === true,
    deadline: options.maxMs === undefined ? undefined : Date.now() + options.maxMs,
    timer: undefined,
    stopped: false,
    snapshots: new Map(),
    targets,
    failures: 0,
  };

  // S'inscrire TOUT DE SUITE, dans le meme tour que le controle ci-dessus et
  // avant la moindre attente reseau. Releve d'etat compris, la lecture d'une
  // lampe debranchee dure ~5 s : tant que la session n'est pas indexee, la
  // touche paraitrait arretee, un second appui lancerait une seconde session, et
  // la premiere tournerait sans plus jamais pouvoir etre arretee.
  sessions.add(session);

  // Relever l'etat avant la premiere image. Un echec de lecture n'empeche pas
  // de jouer : on renonce seulement a restaurer CETTE lampe, ce qui vaut mieux
  // que de refuser de demarrer.
  await Promise.all(targets.map(async (target) => {
    try {
      session.snapshots.set(target.id, await withRetry(target, (bulb) => bulb.read()));
    } catch {
      // Lampe injoignable a la lecture : elle le sera sans doute a l'ecriture,
      // et la tolerance aux echecs se chargera d'arreter proprement.
    }
  }));

  // L'utilisateur a pu appuyer de nouveau pendant le releve : rien n'a encore
  // ete joue, il n'y a donc rien a restaurer, seulement a ne pas demarrer.
  if (session.stopped) return false;
  return tick(session, scenario, 0);
}

/** La session qui occupe l'une de ces lampes, ou undefined. */
function occupant(targets: readonly Target[]): Session | undefined {
  for (const target of targets) {
    const session = sessions.get(target.id);
    if (session) return session;
  }
  return undefined;
}

/** Arrete le scenario qui occupe cette ampoule et restaure ses lampes. Idempotent. */
export async function stop(bulbId: string | undefined): Promise<void> {
  const session = bulbId ? sessions.get(bulbId) : undefined;
  if (session) await stopSession(session);
}

/**
 * Arrete CETTE session, pas celle qui occupe aujourd'hui la meme lampe.
 *
 * Par identite plutot que par identifiant d'ampoule : une image en vol qui
 * echoue pour la troisieme fois peut arriver apres que la session a ete
 * remplacee, et `stop(id)` arreterait alors la nouvelle a sa place.
 */
async function stopSession(session: Session): Promise<void> {
  if (session.stopped) return;

  sessions.remove(session);
  session.stopped = true;
  if (session.timer) clearTimeout(session.timer);

  await Promise.all(session.targets.map(async (target) => {
    const snapshot = session.snapshots.get(target.id);
    if (!snapshot) return;
    try {
      await restore(target, snapshot);
    } catch {
      // Une lampe qu'on ne peut plus joindre ne sera pas restauree ; insister
      // bloquerait l'arret, qui doit rester immediat du point de vue de
      // l'utilisateur.
    }
  }));
}

/** Arrete tout. Appele a l'extinction du plugin. */
export async function stopAll(): Promise<void> {
  await Promise.all(sessions.unique().map(stopSession));
}
