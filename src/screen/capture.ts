/**
 * Lancement du capteur d'ecran (`lumendeck-capture.exe`, ecrit en Rust) et lecture
 * de ce qu'il dit.
 *
 * Ce que fait ce module : demarrer le capteur, decouper sa sortie standard en
 * lignes, les faire lire par `parseCaptureLine`, et le tuer proprement.
 *
 * Choix non evidents :
 *
 *   - Le capteur est un PROCESSUS a part, pas un module Node : la capture rapide
 *     passe par Direct3D, que Node ne sait pas appeler. Il ne sait rien des
 *     ampoules ; il mesure, le plugin decide (voir zones.ts).
 *
 *   - La liaison est la plus pauvre possible : une ligne JSON par image sur la
 *     sortie standard. Sa fermeture d'entree est le signal d'arret : si le plugin
 *     meurt sans nettoyer, le capteur voit l'entree se fermer et s'en va, au lieu
 *     de rester a capturer l'ecran pour personne.
 *
 *   - Le lanceur est INJECTABLE (`CaptureLauncher`) : les tests de la session
 *     de suivi lui substituent un faux capteur qui parle quand ils le decident.
 *
 * Invariants : un capteur lance est toujours tue par `stop()` (idempotent) ; une
 * sortie du processus que nous n'avons pas demandee est signalee par `onExit` ;
 * rien de ce que le capteur ecrit n'est cru sans passer par `parseCaptureLine`.
 *
 * Usage canonique :
 *   const launcher = createCaptureLauncher(exePath);
 *   const handle = launcher.launch({ screen: 'primary', zones: 2 }, onEvent, onExit);
 *   handle.stop();
 */
import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';

import { CAPTURE_FPS, parseCaptureLine, type CaptureEvent } from './zones.ts';

/** Ce qu'on demande au capteur. */
export type CaptureOptions = {
  /** `primary` (l'ecran principal) ou l'index d'un ecran, tel que le rend `listScreens`. */
  readonly screen: string;
  /** Nombre de zones d'ecran mesurees, de gauche a droite. */
  readonly zones: number;
};

export type CaptureHandle = { stop(): void };

export type CaptureLauncher = {
  /** Vrai si le capteur est installe. Faux : le suivi d'ecran n'est pas disponible. */
  available(): boolean;
  /** Lance le capteur. `onExit` n'est appele que pour une sortie NON demandee. */
  launch(options: CaptureOptions, onEvent: (event: CaptureEvent) => void, onExit: () => void): CaptureHandle;
};

/** Un ecran proposable dans le panneau. */
export type ScreenInfo = { readonly index: number; readonly label: string; readonly primary: boolean };

/** Delai accorde au capteur pour dresser la liste des ecrans. */
const LIST_TIMEOUT_MS = 4000;
/** Longueur maximale d'une ligne en attente : une mesure tient en quelques dizaines d'octets. */
const MAX_LINE_LENGTH = 4096;
/** Seul motif d'ecran accepte : `primary` ou un petit entier. Le reste ne part jamais sur la ligne de commande. */
const SCREEN_PATTERN = /^(primary|\d{1,2})$/;

/**
 * Decoupe un flux de morceaux de texte en lignes completes.
 *
 * Un morceau peut s'arreter au milieu d'une ligne : le reste est garde pour le
 * suivant. Sans cela, une ligne coupee en deux serait lue comme deux lignes
 * douteuses, et une image sur dix serait perdue.
 */
export function createLineSplitter(): (chunk: string) => string[] {
  let rest = '';
  return (chunk) => {
    const parts = (rest + chunk).split('\n');
    // Un capteur qui n'ecrit jamais de fin de ligne ne doit pas faire grossir la memoire sans fin.
    rest = (parts.pop() ?? '').slice(-MAX_LINE_LENGTH);
    return parts.map((line) => line.trim()).filter((line) => line.length > 0);
  };
}

export function createCaptureLauncher(exePath: string): CaptureLauncher {
  return {
    available: () => fs.existsSync(exePath),

    launch(options, onEvent, onExit) {
      const screen = SCREEN_PATTERN.test(options.screen) ? options.screen : 'primary';
      const zones = Number.isFinite(options.zones) ? Math.min(4, Math.max(1, Math.trunc(options.zones))) : 1;
      const child = spawn(exePath, ['--screen', screen, '--zones', String(zones), '--fps', String(CAPTURE_FPS)], {
        stdio: ['pipe', 'pipe', 'ignore'],
        windowsHide: true,
      });

      let stopping = false;
      let reported = false;
      const split = createLineSplitter();
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => {
        for (const line of split(chunk)) {
          const event = parseCaptureLine(line);
          if (event) onEvent(event);
        }
      });
      // Une ecriture sur un tube deja ferme leve EPIPE : sans ecouteur, Node tuerait tout le plugin.
      child.stdin.on('error', () => undefined);
      // `exit` ET `error` peuvent se suivre (binaire absent, puis sortie) : un seul rapport.
      const left = (): void => {
        if (stopping || reported) return;
        reported = true;
        onExit();
      };
      child.on('exit', left);
      child.on('error', left);

      return {
        stop() {
          if (stopping) return;
          stopping = true;
          child.stdin.end();
          child.kill();
        },
      };
    },
  };
}

/**
 * Les ecrans que le capteur sait suivre. Liste vide si le capteur est absent ou
 * muet : le panneau retombe alors sur « ecran principal ».
 */
export function listScreens(exePath: string): Promise<ScreenInfo[]> {
  if (!fs.existsSync(exePath)) return Promise.resolve([]);
  return new Promise((resolve) => {
    execFile(exePath, ['--list'], { timeout: LIST_TIMEOUT_MS, windowsHide: true }, (error, stdout) => {
      if (error) return resolve([]);
      try {
        const raw: unknown = JSON.parse(stdout);
        if (!Array.isArray(raw)) return resolve([]);
        const screens = raw.flatMap((item): ScreenInfo[] => {
          const entry = item as Record<string, unknown>;
          const ok = Number.isInteger(entry.index) && typeof entry.label === 'string' && typeof entry.primary === 'boolean';
          return ok ? [{ index: entry.index as number, label: String(entry.label).slice(0, 60), primary: entry.primary as boolean }] : [];
        });
        resolve(screens);
      } catch {
        resolve([]);
      }
    });
  });
}
