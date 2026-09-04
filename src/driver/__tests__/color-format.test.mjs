/**
 * Verifie les conversions hexadecimal <-> TSV. Aucune ampoule requise.
 *
 * Une erreur ici produit une couleur PLAUSIBLE mais fausse : l'ampoule s'allume,
 * rien ne semble casse, et personne ne remarque que le rouge demande est devenu
 * orange. D'ou l'insistance sur les allers-retours et les cas limites.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { hexToHsv, hsvToHex, rotateHue } from '../../color-format.ts';

test('decode les couleurs primaires aux bons angles de teinte', () => {
  assert.deepEqual(hexToHsv('#ff0000'), { h: 0, s: 100, v: 100 }, 'rouge');
  assert.deepEqual(hexToHsv('#00ff00'), { h: 120, s: 100, v: 100 }, 'vert');
  assert.deepEqual(hexToHsv('#0000ff'), { h: 240, s: 100, v: 100 }, 'bleu');
});

test('distingue le noir, le blanc et un gris', () => {
  assert.deepEqual(hexToHsv('#000000'), { h: 0, s: 0, v: 0 }, 'noir');
  assert.deepEqual(hexToHsv('#ffffff'), { h: 0, s: 0, v: 100 }, 'blanc');
  assert.deepEqual(hexToHsv('#808080'), { h: 0, s: 0, v: 50 }, 'gris moyen');
});

test('accepte la forme courte et l absence de diese', () => {
  assert.deepEqual(hexToHsv('#f00'), hexToHsv('#ff0000'), 'forme courte');
  assert.deepEqual(hexToHsv('ff0000'), hexToHsv('#ff0000'), 'sans diese');
  assert.deepEqual(hexToHsv('  #FF0000  '), hexToHsv('#ff0000'), 'espaces et majuscules');
});

test('refuse une chaine malformee au lieu de deviner', () => {
  for (const bad of ['', '#', 'zzz', '#12345', '#1234567', 'rouge']) {
    assert.equal(hexToHsv(bad), null, 'aurait du rejeter ' + JSON.stringify(bad));
  }
});

test('l aller-retour hex -> TSV -> hex est stable', () => {
  for (const hex of ['#ff0000', '#00ff00', '#0000ff', '#ff8800', '#123456', '#ffffff', '#000000']) {
    const hsv = hexToHsv(hex);
    assert.notEqual(hsv, null, hex + ' aurait du se decoder');
    const back = hsvToHex(hsv);
    // Une unite d'ecart par composante est tolerable : on passe par des
    // pourcentages entiers, donc l'information n'est pas integralement conservee.
    for (let i = 1; i < 7; i += 2) {
      const a = parseInt(hex.replace('#', '').slice(i - 1, i + 1), 16);
      const b = parseInt(back.slice(i, i + 2), 16);
      assert.ok(Math.abs(a - b) <= 3, hex + ' -> ' + back + ' derive trop sur l octet ' + i);
    }
  }
});

test('la rotation de teinte preserve saturation et valeur', () => {
  const base = { h: 350, s: 80, v: 60 };
  const turned = rotateHue(base, 30);
  assert.equal(turned.h, 20, 'doit repasser par zero');
  assert.equal(turned.s, base.s, 'saturation intacte');
  assert.equal(turned.v, base.v, 'valeur intacte');
});

test('la rotation gere les valeurs negatives et les tours complets', () => {
  assert.equal(rotateHue({ h: 10, s: 1, v: 1 }, -30).h, 340, 'vers l arriere');
  assert.equal(rotateHue({ h: 10, s: 1, v: 1 }, 720).h, 10, 'deux tours complets');
});
