/**
 * Verifie les decisions d'etat du service Twitch. Aucun SDK.
 *
 * Ce qui casse en silence : un panneau bloque sur « appairage » apres une
 * annulation (seul un redemarrage le debloque), ou une session expiree
 * presentee comme une simple « erreur » sans bouton pour se reconnecter.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { failureState, restoredLink } from '../../twitch/state.ts';

test('sans session, une annulation ramene a « non connecte »', () => {
  assert.equal(restoredLink(false, 'disconnected'), 'disconnected');
  assert.equal(restoredLink(false, 'online'), 'disconnected');
});

test('avec une session et une liaison vivante, une annulation retrouve l etat de la liaison', () => {
  assert.equal(restoredLink(true, 'online'), 'online');
  assert.equal(restoredLink(true, 'connecting'), 'connecting');
});

test('avec une session mais SANS liaison (revoquee, refusee), on retrouve « session a refaire »', () => {
  // Le cas qui bloquait le panneau : la session existe encore sur le disque,
  // mais plus rien n'ecoute. Annuler ne doit pas laisser « appairage » affiche.
  assert.equal(restoredLink(true, undefined), 'auth-needed');
  assert.equal(restoredLink(true, 'pairing'), 'auth-needed');
  assert.equal(restoredLink(true, 'disconnected'), 'auth-needed');
});

test('une session expiree demande de se reconnecter, elle n est pas une « erreur »', () => {
  assert.deepEqual(failureState('reconnect-needed'), { link: 'auth-needed', problem: 'reconnect-needed' });
  assert.deepEqual(failureState('unauthorized'), { link: 'auth-needed', problem: 'reconnect-needed' });
});

test('une panne reseau se reessaie toute seule : on reste en connexion', () => {
  assert.deepEqual(failureState('network'), { link: 'connecting', problem: 'network' });
});

test('un blocage connu (titre pris, compte refuse) est un probleme a lire', () => {
  assert.deepEqual(failureState('duplicate'), { link: 'problem', problem: 'duplicate' });
  assert.deepEqual(failureState('forbidden'), { link: 'problem', problem: 'forbidden' });
});

test('une panne inconnue retombe sur un probleme generique, sans inventer de cause', () => {
  assert.deepEqual(failureState('quelque-chose'), { link: 'problem', problem: 'quelque-chose' });
});
