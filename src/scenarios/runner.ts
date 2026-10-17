/**
 * Moteur de scenarios du plugin : liaison d'engine.ts au vrai pilote.
 *
 * Ce que fait ce module : brancher le moteur (engine.ts, teste sans ampoule)
 * sur le reservoir de connexions et les minuteries de Node. Toute la logique —
 * une execution par ampoule, releve et restauration de l'etat, duree maximale,
 * jeu d'ensemble — vit dans engine.ts ; ce fichier n'a rien d'autre a faire.
 *
 * Invariant : il n'existe qu'UN moteur dans le plugin. Les touches et les
 * rachats Twitch passent tous par ces fonctions, pour qu'un scenario lance par
 * un viewer et une touche pointant la meme lampe se voient l'un l'autre.
 *
 * Usage canonique :
 *   await start(byId('gyrophare'), [coordsA, coordsB], { together: true });
 *   await stop(coordsA.id);
 */
import { withRetry } from '../driver/pool.js';
import { createEngine } from './engine.js';

export type { StartOptions, Target } from './engine.js';

const engine = createEngine({
  withBulb: withRetry,
  timers: {
    set: (callback, ms) => setTimeout(callback, ms),
    clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  },
  now: Date.now,
});

/** Lance un scenario ; rend vrai si sa premiere image a atteint au moins une lampe. */
export const start = engine.start;
/** Arrete le scenario qui occupe cette ampoule et restaure ses lampes. Idempotent. */
export const stop = engine.stop;
/** Arrete tout. Appele a l'extinction du plugin. */
export const stopAll = engine.stopAll;
/** Le scenario en cours sur cette ampoule, principale ou non, ou undefined. */
export const runningOn = engine.runningOn;
/** Se termine quand le scenario qui occupe cette ampoule s'arrete ; tout de suite si rien ne tourne. */
export const untilStopped = engine.untilStopped;
