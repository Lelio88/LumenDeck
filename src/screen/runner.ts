/**
 * Suivi d'ecran du plugin : liaison de sync.ts au vrai moteur et au vrai capteur.
 *
 * Ce que fait ce module : brancher `createScreenSync` (teste sans ecran) sur le
 * moteur de scenarios du plugin et sur `lumendeck-capture.exe`, installe a cote
 * de `bin/plugin.js` par `npm run build:capture`.
 *
 * Invariant : il n'existe qu'UN suivi d'ecran dans le plugin, branche sur l'UNIQUE
 * moteur (scenarios/runner.ts) — c'est ce qui le rend exclusif avec les scenarios
 * et les rachats Twitch sur une meme lampe.
 *
 * Usage canonique :
 *   await screenSync.start(targets, { screen: 'primary', mode: 'zones' });
 */
import { fileURLToPath } from 'node:url';

import { runningOn, startLive, stop } from '../scenarios/runner.js';
import { createCaptureLauncher, listScreens, type ScreenInfo } from './capture.js';
import { createScreenSync } from './sync.js';

/** Le capteur vit a cote du bundle : `bin/plugin.js` et `bin/lumendeck-capture.exe`. */
const CAPTURE_EXE = fileURLToPath(new URL('./lumendeck-capture.exe', import.meta.url));

export const screenSync = createScreenSync({
  engine: { startLive, stop, runningOn },
  launcher: createCaptureLauncher(CAPTURE_EXE),
});

/** Les ecrans que le panneau peut proposer. Liste vide si le capteur est absent. */
export function screens(): Promise<ScreenInfo[]> {
  return listScreens(CAPTURE_EXE);
}
