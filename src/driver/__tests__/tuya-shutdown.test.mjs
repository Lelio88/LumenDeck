/**
 * Verifie qu'une connexion FERMEE par le plugin ne peut plus jamais se rouvrir.
 *
 * Contexte : l'envoi de tuyapi (`_send`) rouvre tout seul une connexion fermee, jusqu'a cinq
 * fois, et `disconnect()` ne fait rien tant que la connexion n'est pas etablie. Un ordre en
 * vol sur une connexion que le plugin croyait fermee la rouvrait donc en arriere-plan, hors de
 * toute vue. Ces connexions s'empilaient jusqu'a ce que l'ampoule refuse tout, y compris les
 * autres touches ; seul le redemarrage de Stream Deck (qui tue le processus) y remediait.
 *
 * Ce qui casse en silence : un test qui ne regarderait que `disconnect()` verrait une
 * connexion « fermee » alors qu'elle se rouvre au prochain ordre.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { shutDown } from '../tuya.ts';

function fakeDevice({ withClient = true } = {}) {
  const events = [];
  const device = {
    events,
    disconnect: () => { events.push('disconnect'); },
    connect: async () => { events.push('connect'); return true; },
  };
  if (withClient) device.client = { destroy: () => { events.push('destroy'); } };
  return device;
}

test('une connexion fermee refuse de se rouvrir', async () => {
  const device = fakeDevice();
  shutDown(device);
  device.events.length = 0;
  await assert.rejects(device.connect(), /fermee/);
  assert.ok(!device.events.includes('connect'), 'le vrai connect n est jamais atteint');
});

test('la fermeture detruit le socket meme quand disconnect() ne fait rien', () => {
  // tuyapi : disconnect() est sans effet tant que la connexion n'est pas etablie.
  const device = fakeDevice();
  shutDown(device);
  assert.ok(device.events.includes('disconnect'));
  assert.ok(device.events.includes('destroy'), 'le socket est detruit explicitement');
});

test('fermer deux fois est sans danger', () => {
  const device = fakeDevice();
  shutDown(device);
  assert.doesNotThrow(() => shutDown(device));
});

test('un appareil sans socket (jamais connecte) se ferme sans erreur', () => {
  const device = fakeDevice({ withClient: false });
  assert.doesNotThrow(() => shutDown(device));
});

test('un socket qui refuse de se detruire ne bloque pas la fermeture', () => {
  const device = fakeDevice();
  device.client.destroy = () => { throw new Error('deja ferme'); };
  assert.doesNotThrow(() => shutDown(device));
  assert.ok(device.events.includes('disconnect'));
});
