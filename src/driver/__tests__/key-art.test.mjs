/**
 * Verifie le dessin des faces de touche. Aucune ampoule, aucun Stream Deck.
 *
 * On ne teste pas « c'est joli » — cela ne se teste pas. On teste ce qui casse
 * en silence : une jauge qui ne bouge plus avec la valeur, une temperature dont
 * la teinte part a l'envers, un SVG malforme que Stream Deck refuserait sans
 * rien dire.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { arcPath, brightnessKey, colorKey, kelvinToRgb, temperatureKey } from '../../key-art.ts';

const wellFormed = (svg) => svg.startsWith('<svg') && svg.endsWith('</svg>');

test('les trois faces produisent un SVG bien forme', () => {
  assert.ok(wellFormed(brightnessKey(40, true)), 'intensite');
  assert.ok(wellFormed(colorKey('#ff8800', true)), 'couleur');
  assert.ok(wellFormed(temperatureKey(4000, true)), 'temperature');
});

test('la jauge affiche la valeur demandee', () => {
  assert.match(brightnessKey(40, true), /40 %/);
  assert.match(brightnessKey(7, true), /7 %/);
});

test('la jauge borne les valeurs aberrantes au lieu de les dessiner', () => {
  assert.match(brightnessKey(999, true), /100 %/, 'au-dessus du maximum');
  assert.match(brightnessKey(-50, true), /0 %/, 'en dessous du minimum');
});

test('a zero pour cent, aucun arc de remplissage n est trace', () => {
  // Deux traces = piste + remplissage ; un seul = piste nue.
  const empty = (brightnessKey(0, true).match(/<path/g) ?? []).length;
  const half = (brightnessKey(50, true).match(/<path/g) ?? []).length;
  assert.equal(empty, 1, 'a zero, seule la piste');
  assert.equal(half, 2, 'a cinquante, piste et remplissage');
});

test('une ampoule eteinte se dessine en gris et le dit', () => {
  for (const svg of [brightnessKey(50, false), colorKey('#ff0000', false), temperatureKey(4000, false)]) {
    assert.ok(!svg.includes('#ffb247'), 'aucun ambre sur une ampoule eteinte');
    assert.match(svg, /#5c6470/, 'la teinte grise doit apparaitre');
  }
  // La goutte se passe de legende : sa couleur suffit, et le mot encombrait.
  assert.ok(!colorKey('#ff0000', false).includes('Eteinte'), 'pas de legende sur la goutte');
  assert.match(brightnessKey(50, false), /Eteinte/, 'la jauge, elle, garde son mot');
});

test('la goutte prend exactement la couleur demandee', () => {
  assert.match(colorKey('#ff0000', true), /#ff0000/, 'rouge pur');
  assert.match(colorKey('#0000ff', true), /#0000ff/, 'bleu pur');
});

test('la temperature va bien du chaud vers le froid', () => {
  const warm = kelvinToRgb(2700);
  const cool = kelvinToRgb(6500);
  const red = (hex) => parseInt(hex.slice(1, 3), 16);
  const blue = (hex) => parseInt(hex.slice(5, 7), 16);

  assert.ok(red(warm) > blue(warm), '2700 K doit tirer vers le rouge, obtenu ' + warm);
  assert.ok(blue(cool) >= red(cool) - 20, '6500 K doit etre neutre ou bleute, obtenu ' + cool);
  assert.ok(blue(cool) > blue(warm), 'le bleu doit croitre avec la temperature');
});

test('la temperature est bornee a la plage de l ampoule', () => {
  assert.match(temperatureKey(99999, true), /6500 K/);
  assert.match(temperatureKey(10, true), /2700 K/);
});

test('l arc prend le grand chemin au-dela d un demi-tour', () => {
  assert.match(arcPath(72, 58, 40, 0, 90), / 0 0 1 /, 'quart de tour : petit arc');
  assert.match(arcPath(72, 58, 40, 0, 270), / 0 1 1 /, 'trois quarts : grand arc');
});

test('aucun dessin n emploie une couleur que QSvg refuserait', () => {
  // Stream Deck rend le SVG avec QSvg (SVG Tiny 1.2), aligne sur CSS2 : rgba(),
  // hsl() et consorts font rejeter le document ENTIER, sans erreur ni journal.
  // La touche garde alors l'image du manifeste et semble simplement figee — un
  // bug indetectable a la lecture du code, d'ou ce garde-fou.
  const interdits = /rgba\(|hsla?\(|color-mix\(|var\(--/;
  const dessins = [
    ['intensite allumee', brightnessKey(55, true)],
    ['intensite eteinte', brightnessKey(55, false)],
    ['couleur allumee', colorKey('#8b5cf6', true)],
    ['couleur eteinte', colorKey('#8b5cf6', false)],
    ['temperature allumee', temperatureKey(4000, true)],
    ['temperature eteinte', temperatureKey(4000, false)],
  ];
  for (const [nom, svg] of dessins) {
    const trouve = svg.match(interdits);
    assert.equal(trouve, null, nom + ' emploie ' + (trouve ? trouve[0] : ''));
  }
});
