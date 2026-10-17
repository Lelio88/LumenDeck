/**
 * Verifie ce que la touche Twitch montre selon l'etat du service. Aucun SDK.
 *
 * Le defaut a prevenir : une touche ambre alors que les viewers ne peuvent rien
 * faire (pause, session morte), ou grise alors qu'ils le peuvent.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { twitchFace } from '../../twitch/face.ts';

test('en ligne et active : ambre, sans mot', () => {
  assert.deepEqual(twitchFace('online', false), { mode: 'live', wordKey: '' });
});

test('en ligne mais en pause : grise, et le mot dit pourquoi', () => {
  assert.deepEqual(twitchFace('online', true), { mode: 'paused', wordKey: 'key.paused' });
});

test('la pause se voit meme quand la liaison tombe : elle reste la raison affichee', () => {
  // Un streamer qui a mis en pause ne doit pas voir « erreur » parce que le reseau a bronche.
  assert.equal(twitchFace('connecting', true).wordKey, 'key.paused');
});

test('une session a refaire demande de passer par le panneau', () => {
  assert.deepEqual(twitchFace('auth-needed', false), { mode: 'idle', wordKey: 'key.toSet' });
  assert.deepEqual(twitchFace('disconnected', false), { mode: 'idle', wordKey: 'key.toSet' });
  assert.deepEqual(twitchFace('pairing', false), { mode: 'idle', wordKey: 'key.toSet' });
});

test('un blocage connu se dit en erreur', () => {
  assert.deepEqual(twitchFace('problem', false), { mode: 'idle', wordKey: 'key.error' });
});

test('une reconnexion en cours est grise et muette : elle dure quelques secondes', () => {
  assert.deepEqual(twitchFace('connecting', false), { mode: 'idle', wordKey: '' });
});
