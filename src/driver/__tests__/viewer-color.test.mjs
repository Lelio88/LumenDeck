/**
 * Verifie la lecture d'une couleur TAPEE PAR UN VIEWER. Aucun SDK, aucune ampoule.
 *
 * Ce texte vient d'un inconnu : la regle est stricte. Ce qui casse en silence
 * serait d'accepter un texte ambigu et de peindre une couleur que personne n'a
 * demandee, ou de laisser un viewer eteindre la piece avec un noir deguise.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { COLOR_NAMES, parseViewerColor } from '../../twitch/viewer-color.ts';

test('un nom de couleur francais est compris, sans egard pour la casse ni les espaces', () => {
  assert.deepEqual(parseViewerColor('rouge'), { ok: true, color: { h: 0, s: 100, v: 100 } });
  assert.deepEqual(parseViewerColor('  Vert '), { ok: true, color: { h: 120, s: 100, v: 100 } });
  assert.deepEqual(parseViewerColor('BLEU'), { ok: true, color: { h: 240, s: 100, v: 100 } });
});

test('un nom de couleur anglais donne la meme couleur que son equivalent francais', () => {
  assert.deepEqual(parseViewerColor('red'), parseViewerColor('rouge'));
  assert.deepEqual(parseViewerColor('green'), parseViewerColor('vert'));
  assert.deepEqual(parseViewerColor('blue'), parseViewerColor('bleu'));
});

test('le blanc est une couleur valide : saturation nulle, pleine valeur', () => {
  assert.deepEqual(parseViewerColor('blanc'), { ok: true, color: { h: 0, s: 0, v: 100 } });
});

test('l hexadecimal strict avec diese est compris', () => {
  assert.deepEqual(parseViewerColor('#ff0000'), { ok: true, color: { h: 0, s: 100, v: 100 } });
  assert.deepEqual(parseViewerColor('#00FF00'), { ok: true, color: { h: 120, s: 100, v: 100 } });
  assert.deepEqual(parseViewerColor('#f00'), { ok: true, color: { h: 0, s: 100, v: 100 } });
});

test('un hexadecimal sans diese est refuse plutot que devine', () => {
  // « facade » est aussi un mot : sans diese, on ne sait pas ce que le viewer veut.
  assert.deepEqual(parseViewerColor('ff0000'), { ok: false, reason: 'unknown' });
  assert.deepEqual(parseViewerColor('facade'), { ok: false, reason: 'unknown' });
});

test('un texte qui contient autre chose qu une couleur est refuse en entier', () => {
  assert.deepEqual(parseViewerColor('rouge vif'), { ok: false, reason: 'unknown' });
  assert.deepEqual(parseViewerColor('#ff0000 puis noir'), { ok: false, reason: 'unknown' });
  assert.deepEqual(parseViewerColor('rouge; eteins tout'), { ok: false, reason: 'unknown' });
});

test('un texte vide ou fait d espaces est refuse avec sa raison', () => {
  assert.deepEqual(parseViewerColor(''), { ok: false, reason: 'empty' });
  assert.deepEqual(parseViewerColor('   '), { ok: false, reason: 'empty' });
  assert.deepEqual(parseViewerColor(undefined), { ok: false, reason: 'empty' });
});

test('un texte demesure est refuse sans etre examine', () => {
  assert.deepEqual(parseViewerColor('a'.repeat(500)), { ok: false, reason: 'too-long' });
});

test('le noir et les quasi-noirs sont refuses : un viewer n eteint pas la piece', () => {
  assert.deepEqual(parseViewerColor('noir'), { ok: false, reason: 'too-dark' });
  assert.deepEqual(parseViewerColor('black'), { ok: false, reason: 'too-dark' });
  assert.deepEqual(parseViewerColor('#000000'), { ok: false, reason: 'too-dark' });
  assert.deepEqual(parseViewerColor('#010101'), { ok: false, reason: 'too-dark' });
});

test('une couleur sombre mais visible reste acceptee', () => {
  const result = parseViewerColor('#800000');
  assert.equal(result.ok, true);
  assert.equal(result.color.v, 50);
});

test('les caracteres etranges ne font ni planter ni passer', () => {
  assert.deepEqual(parseViewerColor('\u0000‮#ff0000'), { ok: false, reason: 'unknown' });
  assert.deepEqual(parseViewerColor('\u{1F308}'), { ok: false, reason: 'unknown' });
});

test('chaque nom de la table est lisible et assez lumineux pour etre vu', () => {
  for (const name of COLOR_NAMES) {
    const result = parseViewerColor(name);
    // Les noms du noir sont dans la table pour etre REFUSES avec leur vraie raison.
    if (['noir', 'black', 'schwarz', 'negro', 'nero'].includes(name)) {
      assert.equal(result.ok, false, name);
      continue;
    }
    assert.equal(result.ok, true, name);
  }
});

test('les noms allemands, espagnols et italiens sont compris comme leurs equivalents', () => {
  const same = (names, reference) => {
    for (const name of names) assert.deepEqual(parseViewerColor(name), parseViewerColor(reference), name);
  };
  same(['rot', 'rojo', 'rosso'], 'rouge');
  same(['blau', 'azul', 'blu'], 'bleu');
  same(['gelb', 'amarillo', 'giallo'], 'jaune');
  same(['gruen', 'grün', 'verde'], 'vert');
  same(['weiss', 'weiß', 'blanco', 'bianco'], 'blanc');
  same(['rosa'], 'rose');
});

test('le noir dans toutes les langues est refuse avec sa vraie raison', () => {
  for (const name of ['schwarz', 'negro', 'nero']) {
    assert.deepEqual(parseViewerColor(name), { ok: false, reason: 'too-dark' }, name);
  }
});

test('les exemples cites aux viewers dans CHAQUE langue sont acceptes', async () => {
  // Le texte de la recompense est poste sur Twitch dans la langue du streamer :
  // si ses exemples sont refuses, chaque viewer qui les suit est rembourse.
  const { readFileSync } = await import('node:fs');
  const root = new URL('../../../com.lumendeck.bulb.sdPlugin/', import.meta.url);
  for (const lang of ['en', 'fr', 'de', 'es', 'it', 'ja', 'ko', 'zh_CN', 'zh_TW']) {
    const dictionary = JSON.parse(readFileSync(new URL(lang + '.json', root), 'utf8')).Localization;
    for (const text of [dictionary.twitch.reward.colorPrompt, dictionary.pi.twitch.inputHelp]) {
      const listed = /[(（]([^)）]*)[)）]/.exec(text);
      assert.ok(listed, lang + ' : aucune liste d exemples entre parentheses');
      // « pink など », « pink 등 » : on ne garde que le mot-exemple, pas le « etc. » qui le suit.
      const examples = listed[1].split(/[,、]/).map((part) => part.replace('...', '').trim().split(/\s+/)[0]).filter(Boolean);
      assert.ok(examples.length >= 2, lang);
      for (const example of examples) {
        assert.equal(parseViewerColor(example).ok, true, lang + ' : « ' + example + ' » est refuse');
      }
    }
  }
});
