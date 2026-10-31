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
 *     une scene stable ne coute aucun aller-retour, ce qui menage l'ampoule. Et
 *     chaque envoi n'avance que d'un pas borne vers la couleur de l'ecran
 *     (`stepToward`) : les ampoules Tuya n'ont pas de fondu, c'est nous qui le fabriquons.
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
import { createSmoother, differs, gradeZone, isBlack, stepToward, zoneOfBulb, type CaptureEvent } from './zones.ts';

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
  /** Recoit une ligne de debit toutes les `REPORT_EVERY_MS` : images et ecritures par seconde, rien d'autre. */
  readonly report?: (line: string) => void;
  /** Horloge, injectable pour les tests. */
  readonly now?: () => number;
  /** Nomme la cause d'un ordre rate, en un mot sur (ex. `unreachable`) : sans elle, un echec ne se compte que. */
  readonly classify?: (error: unknown) => string;
};

/** Intervalle des rapports de debit. */
const REPORT_EVERY_MS = 5000;

/**
 * Temps minimal entre deux ordres a une MEME lampe (~12 par seconde). Au-dela, les ampoules
 * Tuya decrochent du Wi-Fi : releve en conditions reelles a 23 ordres par seconde pour deux
 * lampes (reconnexions, trous de plusieurs secondes), puis encore des coupures d'une dizaine
 * de secondes a ~12 par lampe. Les pas de `stepToward` sont calcules sur le temps reellement
 * ecoule, donc ce plafond ne change que la finesse, pas la vitesse.
 */
const MIN_WRITE_INTERVAL_MS = 80;

/**
 * Attente avant de retenter une lampe qui vient de rater un ordre : 0,5 s, doublee a chaque echec
 * d'affilee, plafonnee a 5 s. Chaque tentative apres un echec rouvre une connexion TCP, et une
 * ampoule Tuya n'en accepte qu'une poignee : retenter a chaque image (25 fois par seconde) l'a
 * saturee au point de refuser toute connexion, y compris celles des autres touches.
 */
const RETRY_BASE_MS = 500;
const RETRY_MAX_MS = 5000;

/**
 * Intervalle entre deux ordres CONFIRMES a une meme lampe. Entre les deux, les couleurs partent
 * sans attendre l'accuse (voir `LightDriver.streamColor`) ; un ordre confirme sert de sonde :
 * s'il echoue, la lampe est reellement en panne, ce qu'un flux sans accuse ne peut pas dire.
 */
const CONFIRM_EVERY_MS = 4000;

/**
 * Duree de noir continu a partir de laquelle les lampes de la zone s'eteignent. Assez longue
 * pour qu'un fondu au noir ou une scene de nuit n'eteigne rien, assez courte pour qu'un ecran
 * de veille ne laisse pas la piece eclairee en blanc.
 */
const BLACK_OFF_MS = 3000;

export function createScreenSync(deps: SyncDeps): ScreenSync {
  const { engine, launcher, report, classify } = deps;
  const now = deps.now ?? Date.now;

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
      /** Instant du dernier envoi a chaque lampe : la vitesse maximale se compte en temps reel. */
      const sentAt: number[] = targets.map(() => now() - MIN_WRITE_INTERVAL_MS);
      /** Echecs d'affilee par lampe, et instant avant lequel on ne la retente pas. */
      const failStreak: number[] = targets.map(() => 0);
      const retryAt: number[] = targets.map(() => 0);
      /** Instant du dernier ordre confirme a chaque lampe. */
      const confirmedAt: number[] = targets.map(() => Number.NEGATIVE_INFINITY);
      /** Depuis quand chaque zone est noire (ms), ou null. */
      const blackSince: (number | null)[] = Array.from({ length: zoneCount }, () => null);
      /** Lampes eteintes pour cause d'ecran noir (pour ne pas renvoyer l'ordre a chaque image). */
      const switchedOff: boolean[] = targets.map(() => false);
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
          if (!sample || !smoother) continue;
          graded[zone] = gradeZone(smoother.push(sample));
          blackSince[zone] = isBlack(sample) ? (blackSince[zone] ?? now()) : null;
        }
      };

      // Debit reel : ce que la lampe recoit n'est pas ce que la minuterie promet (aller-retour reseau).
      let windowStart = now();
      let images = 0;
      let writes = 0;
      let failures = 0;
      let lastCause = '';
      /** Une lampe vient de rater un ordre : on la laisse respirer, de plus en plus longtemps. */
      const backOff = (index: number): void => {
        failStreak[index] = (failStreak[index] ?? 0) + 1;
        retryAt[index] = now() + Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** ((failStreak[index] ?? 1) - 1));
      };
      const noteFailure = (error: unknown): void => {
        failures += 1;
        if (classify) lastCause = classify(error);
      };
      const countImage = (): void => {
        images += 1;
        const elapsed = now() - windowStart;
        if (elapsed < REPORT_EVERY_MS) return;
        const seconds = elapsed / 1000;
        const failed = failures > 0 ? `, ${(failures / seconds).toFixed(1)} echecs/s${lastCause ? ' (derniere cause : ' + lastCause + ')' : ''}` : '';
        report?.(`suivi d'ecran : ${(images / seconds).toFixed(1)} images/s, ${(writes / seconds).toFixed(1)} ecritures/s${failed}`);
        windowStart = now();
        images = 0;
        writes = 0;
        failures = 0;
      };

      const frameAt = (): Frame => {
        countImage();
        return {
          holdMs: 0,
          cues: targets.map((_, index) => {
            const zone = zoneOfBulb(index, targets.length, zoneCount);
            const at = now();
            if (at < (retryAt[index] ?? 0)) return { idle: true };

            // Ecran noir depuis assez longtemps : on eteint, une seule fois. `sent` est oublie pour que
            // le prochain ordre de couleur rallume la lampe (le premier envoi allume toujours).
            const dark = blackSince[zone];
            if (dark !== null && dark !== undefined && at - dark >= BLACK_OFF_MS) {
              if (switchedOff[index]) return { idle: true };
              switchedOff[index] = true;
              sent[index] = null;
              sentAt[index] = at;
              return {
                on: false,
                onSettled: (reached: boolean, error?: unknown) => {
                  if (reached) { failStreak[index] = 0; return; }
                  switchedOff[index] = false;
                  noteFailure(error);
                  backOff(index);
                },
              };
            }
            switchedOff[index] = false;

            const color = graded[zone];
            // Pas encore de couleur : une consigne vide, qui joint la lampe (premiere image :
            // c'est elle qui dit si une lampe repond). Couleur inchangee : au repos, sans rien toucher.
            if (!color) return {};
            // Un pas borne vers la couleur de l'ecran, pas le saut : la lampe n'a pas de fondu.
            const shown = sent[index] ?? null;
            const elapsedMs = at - (sentAt[index] ?? at);
            if (elapsedMs < MIN_WRITE_INTERVAL_MS) return { idle: true };
            const next = stepToward(shown, color, elapsedMs / 1000);
            if (!differs(shown, next)) return { idle: true };
            const firstWrite = shown === null;
            sent[index] = next;
            sentAt[index] = at;
            writes += 1;
            // Le premier ordre, la reprise apres un echec, et un ordre sur quatre secondes sont confirmes.
            const confirm = firstWrite || at - (confirmedAt[index] ?? Number.NEGATIVE_INFINITY) >= CONFIRM_EVERY_MS;
            if (confirm) confirmedAt[index] = at;
            return {
              color: next,
              stream: !confirm,
              keepOn: !firstWrite,
              // Une ecriture ratee ne vaut pas « envoyee » : on renvoie, en rallumant la lampe,
              // sans quoi une lampe revenue apres une coupure resterait eteinte tant que la scene est stable.
              onSettled: (reached: boolean, error?: unknown) => {
                if (reached) { failStreak[index] = 0; return; }
                sent[index] = null;
                noteFailure(error);
                backOff(index);
              },
            };
          }),
        };
      };

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
