/**
 * Test : l'ordre de couleur du flux (suivi d'ecran) est le plus leger possible.
 *
 * Chaque datapoint ajoute a un ordre alourdit le travail de la puce de l'ampoule, deja
 * limite : le flux n'envoie donc QUE la couleur, jamais le mode. Le mode est reaffirme par
 * les ecritures confirmees (`setColor`), faites regulierement par le suivi.
 *
 * Le constructeur etant prive, le pilote est monte sur un faux appareil.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { TuyaLanDriver } from '../tuya.ts';

function driverOver(sent) {
  const driver = Object.create(TuyaLanDriver.prototype);
  driver.device = { set: async (payload) => { sent.push(payload); } };
  driver.sink = { last: null };
  return driver;
}

test('le flux de couleur n envoie que le datapoint de couleur, sans attendre l accuse', async () => {
  const sent = [];
  await driverOver(sent).streamColor({ h: 120, s: 80, v: 60 });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].shouldWaitForResponse, false);
  assert.deepEqual(Object.keys(sent[0].data), ['24'], 'un seul datapoint : la couleur');
});

test('l ecriture confirmee reaffirme le mode couleur en plus de la couleur', async () => {
  const sent = [];
  await driverOver(sent).setColor({ h: 120, s: 80, v: 60 });
  assert.deepEqual(Object.keys(sent[0].data).sort(), ['21', '24']);
});
