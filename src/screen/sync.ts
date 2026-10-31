/**
 * Suivi de l'ecran : les ampoules prennent la couleur dominante de l'image.
 *
 * Ce que fait ce module : relier le capteur d'ecran (capture.ts), la mise en
 * forme de la couleur (zones.ts) et le moteur de sessions (scenarios/engine.ts),
 * pour qu'un appui sur la touche fasse suivre l'ecran aux lampes choisies.
 *
 * Choix non evidents :
 *
 *   - Le suivi est une session EN DIRECT du moteur de scenarios. Il herite donc
 *     gratuitement de ce que le moteur garantit deja : une seule execution par
 *     lampe (un scenario lance sur une lampe suivie prend sa place, et
 *     inversement), l'etat des lampes releve avant et restaure apres, l'abandon
 *     apres des pannes repetees. Une seconde machinerie de sessions aurait
 *     reintroduit les conflits que le moteur existe pour empecher.
 *
 *   - Le capteur vit exactement aussi longtemps que la session : on s'accroche
 *     a la FIN de CETTE session (le rappel `onEnded` du moteur), quelle qu'en soit
 *     la cause (touche, scenario concurrent, pannes, extinction du plugin), plutot
 *     que de suivre chaque chemin d'arret un par un — ou de deviner la session
 *     d'apres la lampe, qu'un scenario peut avoir reprise entre-temps.
 *
 *   - Le lissage se fait a l'ARRIVEE des images du capteur, pas a la cadence du
 *     moteur : les deux horloges ne sont pas alignees, et lisser au tick
 *     donnerait un amortissement qui dependrait du reseau.
 *
 *   - On n'ecrit a une lampe que si sa couleur a vraiment change (`differs`) :
 *     une scene stable ne coute aucun aller-retour, ce qui menage l'ampoule.
 *
 * Invariants : `frameAt` ne bloque jamais (elle lit le dernier etat connu) ; une
 * lampe n'est allumee qu'une fois (`keepOn` ensuite) ; le capteur est tue a la
 * fin de la session, y compris quand son demarrage echoue.
 *
 * Usage canonique :
 *   const sync = createScreenSync({ engine, launcher });
 *   const result = await sync.start(targets, { screen: 'primary', mode: 'zones' }, (why) => repaint(why));
 *   await sync.stop(targets[0].id);
 */
import type { Hsv } from '../driver/types.ts';
import type { Frame } from '../scenarios/catalogue.ts';
import type { Engine, Target } from '../scenarios/engine.ts';
import type { CaptureLauncher } from './capture.ts';
import { createSmoother, differs, gradeZone, zoneOfBulb, type CaptureEvent } from './zones.ts';

/** Identifiant sous lequel le suivi d'ecran apparait dans le moteur (`runningOn`). */
export const SCREEN_SYNC_ID = 'ecran';

/** Une meme couleur partout, ou une zone d'ecran (gauche / droite) par moitie de la rangee de lampes. */
export type SyncMode = 'same' | 'zones';

export type SyncSettings = {
  /** `primary` ou l'index d'un ecran. */
  readonly screen: string;
  readonly mode: SyncMode;
};

/**
 * `unavailable` : capteur absent. `capture-failed` : il est mort au demarrage.
 * `unreached` : aucune lampe n'a repondu. `cancelled` : arrete pendant le demarrage
 * (second appui) — ce n'est pas une panne, et la touche ne doit pas en annoncer une.
 */
export type StartResult = 'started' | 'unreached' | 'unavailable' | 'capture-failed' | 'cancelled';

/** Pourquoi une session s'est terminee : par la touche ou un scenario (`stopped`), ou parce que le capteur est mort. */
export type SyncEnd = 'stopped' | 'capture-failed';

export type ScreenSync = {
  start(targets: readonly Target[], settings: SyncSettings, onEnd?: (why: SyncEnd) => void): Promise<StartResult>;
  stop(bulbId: string | undefined): Promise<void>;
  /** Vrai si le suivi d'ecran occupe cette lampe. */
  isActive(bulbId: string | undefined): boolean;
};

export type SyncDeps = {
  readonly engine: Pick<Engine, 'startLive' | 'stop' | 'runningOn'>;
  readonly launcher: CaptureLauncher;
};

export function createScreenSync(deps: SyncDeps): ScreenSync {
  const { engine, launcher } = deps;

  return {
    isActive: (bulbId) => engine.runningOn(bulbId) === SCREEN_SYNC_ID,

    stop: (bulbId) => engine.stop(bulbId),

    async start(targets, settings, onEnd) {
      const primary = targets[0];
      if (!primary) return 'unreached';
      if (!launcher.available()) return 'unavailable';

      const zoneCount = settings.mode === 'zones' && targets.length > 1 ? 2 : 1;
      const smoothers = Array.from({ length: zoneCount }, () => createSmoother());
      const graded: (Hsv | null)[] = Array.from({ length: zoneCount }, () => null);
      const sent: (Hsv | null)[] = targets.map(() => null);
      let captureFailed = false;
      /** La session creee ici est terminee (touche, scenario concurrent, pannes, capteur mort). */
      let ended = false;
      /** `start` a rendu `started` : seule une session annoncee a une fin a raconter a l'appelant. */
      let announced = false;

      const onEvent = (event: CaptureEvent): void => {
        if (event.kind !== 'frame') return;
        for (let zone = 0; zone < zoneCount; zone += 1) {
          const sample = event.zones[zone];
          const smoother = smoothers[zone];
          if (sample && smoother) graded[zone] = gradeZone(smoother.push(sample));
        }
      };

      const frameAt = (): Frame => ({
        holdMs: 0,
        cues: targets.map((_, index) => {
          const color = graded[zoneOfBulb(index, targets.length, zoneCount)];
          // Pas encore de couleur : une consigne vide, qui joint la lampe (premiere image :
          // c'est elle qui dit si une lampe repond). Couleur inchangee : au repos, sans rien toucher.
          if (!color) return {};
          if (!differs(sent[index] ?? null, color)) return { idle: true };
          const firstWrite = sent[index] === null;
          sent[index] = color;
          return {
            color,
            keepOn: !firstWrite,
            // Une ecriture ratee ne vaut pas « envoyee » : on renvoie, en rallumant la lampe,
            // sans quoi une lampe revenue apres une coupure resterait eteinte tant que la scene est stable.
            onSettled: (reached: boolean) => { if (!reached) sent[index] = null; },
          };
        }),
      });

      /** Arrete la session SI elle est la notre : pendant le demarrage, la lampe peut encore appartenir a un scenario. */
      const stopOurs = async (): Promise<void> => {
        if (engine.runningOn(primary.id) === SCREEN_SYNC_ID) await engine.stop(primary.id);
      };

      const handle = launcher.launch({ screen: settings.screen, zones: zoneCount }, onEvent, () => {
        captureFailed = true;
        void stopOurs();
      });

      let reached: boolean;
      try {
        reached = await engine.startLive(SCREEN_SYNC_ID, frameAt, targets, () => {
          ended = true;
          handle.stop();
          if (announced) onEnd?.(captureFailed ? 'capture-failed' : 'stopped');
        });
      } catch (error) {
        handle.stop();
        throw error;
      }

      // Le capteur est mort pendant le demarrage : rien ne le dirait plus a personne.
      if (captureFailed) {
        handle.stop();
        await stopOurs();
        return 'capture-failed';
      }
      if (ended) return 'cancelled';
      if (!reached) {
        handle.stop();
        await stopOurs();
        return 'unreached';
      }

      announced = true;
      return 'started';
    },
  };
}
