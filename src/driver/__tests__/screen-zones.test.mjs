/**
 * Verifie la partie « gout » du suivi d'ecran : lecture des lignes du capteur,
 * mise en forme de la couleur, lissage, et repartition des lampes par zone.
 * Aucun ecran, aucune ampoule.
 *
 * Ce qui casse en silence : une ligne mal formee qui allume une lampe en
 * n'importe quelle couleur, un lissage qui fait trainer une coupe franche ou
 * qui laisse scintiller une scene stable, un noir de l'ecran qui eteint la piece
 * au lieu de la tamiser, et une lampe de droite pilotee par la zone de gauche.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  MIN_VALUE,
  createSmoother,
  differs,
  gradeZone,
  parseCaptureLine,
  zoneOfBulb,
} from '../../screen/zones.ts';

test('lit une image du capteur, zone par zone', () => {
  const event = parseCaptureLine('{"zones":[[200,40,40,70],[10,20,30,5]]}');
  assert.deepEqual(event, {
    kind: 'frame',
    zones: [{ rgb: [200, 40, 40], v: 70 }, { rgb: [10, 20, 30], v: 5 }],
  });
});

test('lit un message d etat du capteur', () => {
  assert.deepEqual(parseCaptureLine('{"status":"lost"}'), { kind: 'status', status: 'lost' });
  assert.deepEqual(parseCaptureLine('{"status":"ready"}'), { kind: 'status', status: 'ready' });
});

test('ecarte toute ligne douteuse plutot que d allumer une couleur au hasard', () => {
  for (const line of [
    '', 'pas du json', '{}', '{"zones":[]}', '{"zones":[[1,2,3]]}', '{"zones":[[1,2,3,"x"]]}',
    '{"zones":[[300,0,0,10]]}', '{"zones":[[0,0,0,101]]}', '{"zones":[[0,0,-1,10]]}',
    '{"zones":[[1,2,3,4],[1,2,3,4],[1,2,3,4],[1,2,3,4],[1,2,3,4]]}', '{"status":"autre"}', 'null', '[]',
  ]) assert.equal(parseCaptureLine(line), null, JSON.stringify(line));
});

test('renforce la saturation sans jamais depasser 100', () => {
  const dull = gradeZone({ rgb: [140, 100, 100], v: 50 });
  const raw = { h: 0, s: 29 };
  assert.ok(dull.s > raw.s, 'une couleur terne est avivee');
  assert.ok(gradeZone({ rgb: [255, 0, 0], v: 100 }).s <= 100);
});

test('un ecran noir tamise les lampes au lieu de les eteindre', () => {
  const dark = gradeZone({ rgb: [0, 0, 0], v: 0 });
  assert.equal(dark.v, MIN_VALUE, 'plancher de luminosite');
  assert.ok(MIN_VALUE >= 1, 'jamais 0 : la lampe reste allumee');
});

test('la luminosite suit la scene, bornee a 100', () => {
  assert.ok(gradeZone({ rgb: [200, 50, 50], v: 20 }).v < gradeZone({ rgb: [200, 50, 50], v: 80 }).v);
  assert.equal(gradeZone({ rgb: [255, 255, 255], v: 100 }).v, 100);
});

test('le lissage amortit un petit ecart et suit une coupe franche', () => {
  const smoother = createSmoother();
  const first = smoother.push({ rgb: [100, 100, 100], v: 40 });
  assert.deepEqual(first, { rgb: [100, 100, 100], v: 40 }, 'la premiere image est prise telle quelle');

  const small = smoother.push({ rgb: [110, 100, 100], v: 40 });
  assert.ok(small.rgb[0] > 100 && small.rgb[0] < 110, 'petit ecart : on glisse');

  const cut = createSmoother();
  cut.push({ rgb: [0, 0, 0], v: 0 });
  const jump = cut.push({ rgb: [255, 255, 255], v: 100 });
  assert.ok(jump.rgb[0] > 128, 'coupe franche : on rattrape plus de la moitie d un coup');
});

test('le lissage converge vers une scene stable', () => {
  const smoother = createSmoother();
  smoother.push({ rgb: [0, 0, 0], v: 0 });
  let last = { rgb: [0, 0, 0], v: 0 };
  for (let i = 0; i < 60; i += 1) last = smoother.push({ rgb: [200, 100, 50], v: 60 });
  assert.ok(Math.abs(last.rgb[0] - 200) <= 1 && Math.abs(last.v - 60) <= 1);
});

test('n envoie pas a la lampe un changement imperceptible', () => {
  const a = { h: 200, s: 50, v: 50 };
  assert.equal(differs(null, a), true, 'rien d envoye encore : on envoie');
  assert.equal(differs(a, { h: 201, s: 51, v: 50 }), false);
  assert.equal(differs(a, { h: 210, s: 50, v: 50 }), true);
  assert.equal(differs(a, { h: 200, s: 50, v: 56 }), true);
  assert.equal(differs({ h: 359, s: 50, v: 50 }, { h: 1, s: 50, v: 50 }), false, 'la teinte tourne en rond');
});

test('repartit les lampes sur les zones de gauche a droite', () => {
  const zones = (count, nZones) => Array.from({ length: count }, (_, i) => zoneOfBulb(i, count, nZones));
  assert.deepEqual(zones(2, 2), [0, 1]);
  assert.deepEqual(zones(3, 2), [0, 0, 1]);
  assert.deepEqual(zones(4, 2), [0, 0, 1, 1]);
  assert.deepEqual(zones(3, 1), [0, 0, 0], 'une seule zone : tout le monde pareil');
  assert.deepEqual(zones(1, 2), [0], 'une seule lampe : la zone de gauche');
});
