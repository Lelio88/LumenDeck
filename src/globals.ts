/**
 * Acces partage aux reglages globaux du plugin : liaison du magasin au SDK.
 *
 * Ce que fait ce module : brancher `global-store.ts` (la logique, testee sans
 * SDK) sur les reglages globaux de Stream Deck. Il n'a rien d'autre a faire.
 *
 * Raison d'etre : `setGlobalSettings` REMPLACE l'objet entier. Des qu'un second
 * module (la session Twitch) y range ses donnees a cote du registre d'ampoules,
 * toute ecriture directe efface les cles des autres. TOUTE lecture et TOUTE
 * ecriture des reglages globaux passent donc ici, et la modification d'une cle
 * se calcule a partir de sa valeur courante, dans la file du magasin.
 *
 * Invariant : ne jamais journaliser le contenu — il porte les cles locales des
 * ampoules et les jetons Twitch.
 *
 * Usage canonique :
 *   await updateGlobal('twitch', (current) => ({ ...current, paused: true }));
 */
import streamDeck from '@elgato/streamdeck';

import { createGlobalStore } from './global-store.js';

const store = createGlobalStore({
  // Le SDK type les reglages en JSON strict ; ici on ne fait que les transporter.
  read: async () => (await streamDeck.settings.getGlobalSettings()) as Record<string, unknown> | undefined,
  write: (all) => streamDeck.settings.setGlobalSettings(all as never),
});

/** Lit une cle, ou undefined. */
export const readGlobal = store.read;

/**
 * Modifie UNE cle a partir de sa valeur courante ; les autres restent intactes.
 *
 * `change` rend la nouvelle valeur ; `undefined` supprime la cle. Rend la valeur ecrite.
 */
export const updateGlobal = store.update;
