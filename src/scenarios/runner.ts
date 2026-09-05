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
import { MIN_HOLD_MS, type Cue, type Scenario } from './catalogue.js';

/** Coordonnees d'une ampoule, telles que les rend `coordinatesFor`. */
export type Target = { id: string; key: string; ip?: string; version?: string };

type Session = {
  readonly scenarioId: string;
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

/** Executions en cours, indexees par identifiant de l'ampoule principale. */
const sessions = new Map<string, Session>();

/** Le scenario en cours sur cette ampoule, ou undefined. */
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
 */
async function applyFrame(cues: readonly Cue[], targets: readonly Target[]): Promise<void> {
  await Promise.all(targets.map((target, index) => {
    const cue = cues[Math.min(index, cues.length - 1)];
    return cue ? applyCue(target, cue) : Promise.resolve();
  }));
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

/** Deroule une image puis programme la suivante. */
async function tick(session: Session, scenario: Scenario, step: number): Promise<void> {
  if (session.stopped) return;

  const frame = scenario.frame(step);
  try {
    await applyFrame(frame.cues, session.targets);
    session.failures = 0;
  } catch {
    session.failures += 1;
    if (session.failures >= TOLERANCE) {
      await stop(session.targets[0]?.id);
      return;
    }
  }

  // Relire APRES l'attente reseau : l'utilisateur a pu demander l'arret pendant
  // que l'image partait.
  if (session.stopped) return;

  const next = step + 1;
  if (!scenario.loops && scenario.steps !== undefined && next >= scenario.steps) {
    await stop(session.targets[0]?.id);
    return;
  }

  session.timer = setTimeout(
    () => void tick(session, scenario, next),
    Math.max(MIN_HOLD_MS, frame.holdMs),
  );
}

/**
 * Lance un scenario sur une ou deux ampoules.
 *
 * La premiere ampoule de la liste sert de cle : c'est elle qu'on interroge pour
 * savoir si un scenario tourne, et elle qu'on nomme pour l'arreter.
 */
export async function start(scenario: Scenario, targets: readonly Target[]): Promise<void> {
  const primary = targets[0];
  if (!primary) return;

  // Liberer la lampe avant de la reprendre, sinon deux scenarios se
  // disputeraient les memes images.
  await stop(primary.id);

  const session: Session = {
    scenarioId: scenario.id,
    timer: undefined,
    stopped: false,
    snapshots: new Map(),
    targets,
    failures: 0,
  };

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

  sessions.set(primary.id, session);
  await tick(session, scenario, 0);
}

/** Arrete le scenario de cette ampoule et restaure les lampes. Idempotent. */
export async function stop(bulbId: string | undefined): Promise<void> {
  if (!bulbId) return;
  const session = sessions.get(bulbId);
  if (!session) return;

  sessions.delete(bulbId);
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
  await Promise.all([...sessions.keys()].map(stop));
}
