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
  CAPTURE_FPS,
  MIN_VALUE,
  createSmoother,
  differs,
  gradeZone,
  isBlack,
  lightness,
  parseCaptureLine,
  stepToward,
  zoneOfBulb,
} from '../../screen/zones.ts';

/** Temps ecoule entre deux envois dans ces tests : ~16 par seconde. */
const DT = 1 / 16;

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
  assert.ok(jump.rgb[0] > 40, 'coupe franche : on rattrape nettement plus qu une scene stable');
  assert.ok(jump.rgb[0] < 120, 'mais jamais d un coup : la lampe ne saute pas');
  let last = jump;
  for (let i = 1; i < CAPTURE_FPS / 2; i += 1) last = cut.push({ rgb: [255, 255, 255], v: 100 });
  assert.ok(last.rgb[0] > 235, 'la coupe est rattrapee en une demi-seconde');
});

test('une scene stable change plus doucement qu une coupe', () => {
  const steady = createSmoother();
  steady.push({ rgb: [100, 100, 100], v: 40 });
  const step = steady.push({ rgb: [130, 100, 100], v: 40 }).rgb[0] - 100;
  assert.ok(step > 0 && step < 10, 'un petit ecart ne bouge la lampe que de quelques points (' + step + ')');
});

test('le lissage converge vers une scene stable', () => {
  const smoother = createSmoother();
  smoother.push({ rgb: [0, 0, 0], v: 0 });
  let last = { rgb: [0, 0, 0], v: 0 };
  for (let i = 0; i < CAPTURE_FPS * 20; i += 1) last = smoother.push({ rgb: [200, 100, 50], v: 60 });
  assert.ok(Math.abs(last.rgb[0] - 200) <= 1 && Math.abs(last.v - 60) <= 1);
});

test('envoie des qu un changement est a la portee de l ampoule, pas avant', () => {
  const a = { h: 200, s: 50, v: 50 };
  assert.equal(differs(null, a), true, 'rien d envoye encore : on envoie');
  assert.equal(differs(a, { ...a }), false, 'identique : rien a envoyer');
  assert.equal(differs(a, { h: 200, s: 50.2, v: 50.1 }), false, 'sous la resolution de l ampoule');
  assert.equal(differs(a, { h: 201, s: 50, v: 50 }), true, 'un degre de teinte est la plus petite marche');
  assert.equal(differs(a, { h: 200, s: 51, v: 50 }), true);
  assert.equal(differs(a, { h: 200, s: 50, v: 52 }), true);
  assert.equal(differs({ h: 359, s: 50, v: 50 }, { h: 0, s: 50, v: 50 }), true, 'la teinte tourne en rond : 1 degre');
  assert.equal(differs({ h: 359, s: 50, v: 50 }, { h: 359, s: 50, v: 50 }), false);
});

test('un ecart de luminosite invisible n est pas envoye en haut de plage, mais l est en bas', () => {
  assert.equal(differs({ h: 0, s: 50, v: 98 }, { h: 0, s: 50, v: 99 }), false);
  assert.equal(differs({ h: 0, s: 50, v: 3 }, { h: 0, s: 50, v: 3.6 }), true, 'en bas, un demi-point se voit');
});

test('repartit les lampes sur les zones de gauche a droite', () => {
  const zones = (count, nZones) => Array.from({ length: count }, (_, i) => zoneOfBulb(i, count, nZones));
  assert.deepEqual(zones(2, 2), [0, 1]);
  assert.deepEqual(zones(3, 2), [0, 0, 1]);
  assert.deepEqual(zones(4, 2), [0, 0, 1, 1]);
  assert.deepEqual(zones(3, 1), [0, 0, 0], 'une seule zone : tout le monde pareil');
  assert.deepEqual(zones(1, 2), [0], 'une seule lampe : la zone de gauche');
});

test('la premiere couleur est prise telle quelle : rien d avant dont partir', () => {
  const target = { h: 200, s: 80, v: 70 };
  assert.deepEqual(stepToward(null, target, DT), target);
});

test('la lampe n avance vers sa cible que d un pas borne, par grandeur', () => {
  const from = { h: 100, s: 50, v: 50 };
  const next = stepToward(from, { h: 200, s: 100, v: 100 }, DT);
  assert.ok(next.h > 100 && next.h < 130, 'teinte : un pas, pas le saut (' + next.h + ')');
  assert.ok(next.s > 50 && next.s < 65, 'saturation : un pas (' + next.s + ')');
  assert.ok(next.v > 50 && next.v < 60, 'luminosite : un pas, le plus petit des trois (' + next.v + ')');
});

test('la luminosite est la grandeur la plus bridee', () => {
  const from = { h: 100, s: 50, v: 20 };
  const next = stepToward(from, { h: 160, s: 80, v: 100 }, DT);
  assert.ok(next.v - from.v < next.h - from.h, 'on remarque bien plus un saut de luminosite qu un decalage de teinte');
});

test('arrive exactement sur la cible quand elle est a portee, et ne la depasse jamais', () => {
  const target = { h: 120, s: 60, v: 55 };
  assert.deepEqual(stepToward({ h: 118, s: 58, v: 53 }, target, DT), target);
  let current = { h: 0, s: 0, v: 3 };
  for (let i = 0; i < 40; i += 1) current = stepToward(current, target, DT);
  assert.deepEqual(current, target, 'converge en un nombre fini de pas');
});

test('la teinte prend le plus court chemin, en tournant en rond', () => {
  const up = stepToward({ h: 350, s: 80, v: 50 }, { h: 10, s: 80, v: 50 }, DT);
  assert.ok(up.h > 350 || up.h <= 10, 'de 350 vers 10 : on passe par 0, pas par 180 (' + up.h + ')');
  const down = stepToward({ h: 10, s: 80, v: 50 }, { h: 350, s: 80, v: 50 }, DT);
  assert.ok(down.h < 10 || down.h >= 350, 'de 10 vers 350 : par 0 aussi (' + down.h + ')');
});

test('une lampe presque grise saute directement a la teinte visee', () => {
  const next = stepToward({ h: 0, s: 3, v: 50 }, { h: 240, s: 80, v: 50 }, DT);
  assert.equal(next.h, 240, 'sans couleur visible, tourner la teinte ferait passer la lampe par des teintes parasites');
  assert.ok(next.s < 20, 'la saturation, elle, monte progressivement');
});

test('la luminosite avance par pas EGAUX A L OEIL, pas par pas egaux en pourcentage', () => {
  // 3 % -> 11 % est un bond enorme (la lampe est presque 4 fois plus claire),
  // 80 % -> 88 % ne se voit presque pas : un pas en pourcentage est trop gros en bas et inutile en haut.
  const low = stepToward({ h: 100, s: 80, v: 3 }, { h: 100, s: 80, v: 100 }, DT);
  const high = stepToward({ h: 100, s: 80, v: 80 }, { h: 100, s: 80, v: 100 }, DT);
  assert.ok(low.v - 3 < 4, 'en bas, le pas est petit en pourcentage (' + (low.v - 3).toFixed(1) + ')');
  assert.ok(high.v - 80 > low.v - 3, 'en haut, le meme pas percu est plus grand en pourcentage');
  const seen = (a, b) => Math.abs(lightness(b) - lightness(a));
  assert.ok(Math.abs(seen(3, low.v) - seen(80, high.v)) < 0.005, 'mais identique a l oeil');
});

test('un balayage de luminosite ne comporte aucune marche visible', () => {
  let current = { h: 100, s: 80, v: 3 };
  let worst = 0;
  for (let i = 0; i < 40; i += 1) {
    const next = stepToward(current, { h: 100, s: 80, v: 100 }, DT);
    worst = Math.max(worst, Math.abs(lightness(next.v) - lightness(current.v)));
    current = next;
  }
  assert.ok(worst <= 0.041, 'plus grande marche percue : ' + worst.toFixed(3));
  assert.equal(current.v, 100);
});

test('la luminosite garde une decimale : les marches du bas sont plus fines que 1 point', () => {
  const next = stepToward({ h: 0, s: 50, v: 2 }, { h: 0, s: 50, v: 100 }, DT);
  assert.ok(!Number.isInteger(next.v) || next.v === 2, 'valeur non entiere possible : ' + next.v);
  assert.ok(next.v > 2 && next.v < 3.6, 'le premier pas depuis 2 % reste fin (' + next.v + ')');
});


test('un flash bref ne fait presque pas bouger la luminosite : on suit la scene, pas chaque image', () => {
  const smoother = createSmoother();
  for (let i = 0; i < CAPTURE_FPS * 7; i += 1) smoother.push({ rgb: [60, 60, 90], v: 20 });
  let peak = 0;
  for (let i = 0; i < 3; i += 1) peak = Math.max(peak, smoother.push({ rgb: [255, 255, 255], v: 100 }).v);
  assert.ok(peak < 20 + 0.25 * (100 - 20), 'trois images claires ne depassent pas un quart de l ecart (' + peak.toFixed(1) + ')');
});

test('une scene durablement plus claire finit par etre suivie, en quelques secondes', () => {
  const smoother = createSmoother();
  for (let i = 0; i < CAPTURE_FPS * 7; i += 1) smoother.push({ rgb: [60, 60, 90], v: 20 });
  let level = 20;
  for (let i = 0; i < CAPTURE_FPS * 8; i += 1) level = smoother.push({ rgb: [200, 200, 220], v: 80 }).v; // ~8 s
  assert.ok(level > 70, 'apres ~8 s la lampe a rattrape la scene (' + level.toFixed(1) + ')');
  const early = createSmoother();
  for (let i = 0; i < CAPTURE_FPS * 7; i += 1) early.push({ rgb: [60, 60, 90], v: 20 });
  let after1s = 20;
  for (let i = 0; i < CAPTURE_FPS; i += 1) after1s = early.push({ rgb: [200, 200, 220], v: 80 }).v;
  assert.ok(after1s < 60, 'mais pas en une seconde : la piece ne pompe pas (' + after1s.toFixed(1) + ')');
});

test('la couleur, elle, n est pas ralentie par la moyenne lente de luminosite', () => {
  const smoother = createSmoother();
  for (let i = 0; i < CAPTURE_FPS * 7; i += 1) smoother.push({ rgb: [200, 20, 20], v: 50 });
  let last = smoother.push({ rgb: [20, 20, 200], v: 50 });
  for (let i = 1; i < CAPTURE_FPS / 2; i += 1) last = smoother.push({ rgb: [20, 20, 200], v: 50 });
  assert.ok(last.rgb[2] > 150 && last.rgb[0] < 80, 'le rouge devient bleu en une demi-seconde');
});

test('le caractere du lissage ne depend pas du nombre de mesures par seconde', () => {
  // Une constante de temps, pas un coefficient par image : meme duree de rattrapage a 15 comme a 60 mesures/s.
  const reached = [15, 30, 60].map((fps) => {
    const smoother = createSmoother(fps);
    for (let i = 0; i < fps * 5; i += 1) smoother.push({ rgb: [0, 0, 0], v: 0 });
    let after = smoother.push({ rgb: [200, 200, 200], v: 0 });
    for (let i = 1; i < fps; i += 1) after = smoother.push({ rgb: [200, 200, 200], v: 0 }); // 1 s
    return after.rgb[0];
  });
  assert.ok(reached.every((r) => r > 180 && r < 201), 'apres 1 s la couleur est presque rattrapee : ' + reached.join(', '));
  assert.ok(Math.max(...reached) - Math.min(...reached) < 12, 'et pareil quel que soit le rythme : ' + reached.join(', '));
});

test('la vitesse maximale est une vitesse : plus de temps ecoule, plus grand le pas permis', () => {
  const from = { h: 100, s: 80, v: 50 };
  const target = { h: 220, s: 80, v: 50 };
  const slow = stepToward(from, target, 0.08);
  const fast = stepToward(from, target, 0.02);
  assert.ok(slow.h - 100 > 4 * (fast.h - 100) - 1, 'quatre fois plus de temps, environ quatre fois plus de chemin');
  assert.ok(stepToward(from, target, 5).h - 100 <= 13, 'mais un long silence ne deviendra pas un saut : le temps est borne');
});

test('reconnait un ecran noir, et pas une scene seulement sombre', () => {
  assert.equal(isBlack({ rgb: [0, 0, 0], v: 0 }), true);
  assert.equal(isBlack({ rgb: [0, 0, 0], v: 1 }), true, 'a un point de luminosite pres');
  assert.equal(isBlack({ rgb: [12, 8, 6], v: 4 }), false, 'une scene sombre n est pas un ecran noir');
  assert.equal(isBlack({ rgb: [0, 0, 0], v: 8 }), false);
});

test('un ecran qui devient noir garde la teinte : seule la luminosite descend, la lampe ne vire pas au blanc', () => {
  const smoother = createSmoother();
  for (let i = 0; i < CAPTURE_FPS * 3; i += 1) smoother.push({ rgb: [220, 30, 30], v: 60 });
  let last = smoother.push({ rgb: [0, 0, 0], v: 0 });
  for (let i = 0; i < CAPTURE_FPS * 6; i += 1) last = smoother.push({ rgb: [0, 0, 0], v: 0 });
  assert.deepEqual(last.rgb, [220, 30, 30], 'la couleur d avant le noir est conservee');
  assert.ok(last.v < 12, 'et la luminosite est tombee (' + last.v.toFixed(1) + ')');
  const color = gradeZone(last);
  assert.ok(color.s > 60 && (color.h < 15 || color.h > 345), 'la lampe reste rouge, pas blanche : ' + JSON.stringify(color));
});

test('un ecran noir des le debut n invente pas de couleur', () => {
  const smoother = createSmoother();
  assert.deepEqual(smoother.push({ rgb: [0, 0, 0], v: 0 }).rgb, [0, 0, 0]);
});
