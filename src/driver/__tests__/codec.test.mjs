/**
 * Verifie les conversions pures du pilote Tuya — aucune ampoule requise.
 * Ce sont les calculs ou une erreur de facteur 10 passe inapercue a l'oeil.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  encodeColor, decodeColor, pctToTuya, tuyaToPct, kelvinToTuya, tuyaToKelvin,
} from '../tuya.ts';

test('decode la couleur reelle relevee sur l ampoule Bureau', () => {
  // Arrange : valeur brute lue en LAN le 2026-09-04.
  const raw = '006d03e800fa';
  // Act
  const hsv = decodeColor(raw);
  // Assert : teinte 109 deg, saturation pleine, valeur au quart.
  assert.deepEqual(hsv, { h: 109, s: 100, v: 25 });
});

test('encode puis decode restitue la couleur (aller-retour)', () => {
  for (const color of [{ h: 0, s: 0, v: 1 }, { h: 109, s: 100, v: 25 }, { h: 360, s: 100, v: 100 }]) {
    assert.deepEqual(decodeColor(encodeColor(color)), color, `aller-retour casse pour ${JSON.stringify(color)}`);
  }
});

test('refuse une chaine couleur malformee au lieu de deviner', () => {
  for (const bad of ['', 'zzzz', '006d03e8', null, undefined, 42]) {
    assert.equal(decodeColor(bad), null, `aurait du rejeter ${JSON.stringify(bad)}`);
  }
});

test('la luminosite respecte le plancher materiel de 10/1000', () => {
  assert.equal(pctToTuya(0), 10, 'Tuya ne descend pas sous 10');
  assert.equal(pctToTuya(1), 10);
  assert.equal(pctToTuya(50), 500);
  assert.equal(pctToTuya(100), 1000);
  assert.equal(pctToTuya(999), 1000, 'doit borner au maximum');
});

test('la luminosite fait un aller-retour stable', () => {
  for (const pct of [1, 25, 50, 75, 100]) {
    assert.equal(tuyaToPct(pctToTuya(pct)), pct, `instable a ${pct} %`);
  }
});

test('les bornes de temperature correspondent a la plage annoncee', () => {
  assert.equal(tuyaToKelvin(0), 2700, 'extremite chaude');
  assert.equal(tuyaToKelvin(1000), 6500, 'extremite froide');
  assert.equal(kelvinToTuya(2700), 0);
  assert.equal(kelvinToTuya(6500), 1000);
  assert.equal(kelvinToTuya(4600), 500, 'le milieu doit tomber au milieu');
});

test('la temperature fait un aller-retour a 10 K pres', () => {
  for (const k of [2700, 3500, 4600, 5500, 6500]) {
    assert.ok(Math.abs(tuyaToKelvin(kelvinToTuya(k)) - k) <= 10, `derive trop grande a ${k} K`);
  }
});
