/**
 * Verifie le catalogue de scenarios. Aucune ampoule, aucun Stream Deck.
 *
 * On ne teste pas « c'est joli » — cela ne se teste pas. On teste ce qui casse
 * en silence : une duree si courte qu'elle ferait stroboscope, un scenario a
 * fin annoncee qui ne s'arreterait jamais, un role sans consigne, une teinte
 * hors du cercle chromatique.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { MIN_HOLD_MS, SCENARIOS, byId, frameFor } from '../../scenarios/catalogue.ts';

/** Les cinquante premieres images d'un scenario, ce qui couvre tous les cycles. */
const firstFrames = (scenario, count = 50) =>
  Array.from({ length: count }, (_, step) => scenario.frame(step));

test('chaque scenario a un identifiant unique', () => {
  const ids = SCENARIOS.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('on retrouve un scenario par son identifiant, et rien d autre', () => {
  assert.equal(byId('gyrophare')?.id, 'gyrophare');
  assert.equal(byId('inconnu'), undefined);
  assert.equal(byId(undefined), undefined);
});

test('aucune image ne descend sous la duree minimale', () => {
  // C'est la garantie de sante du catalogue : au-dela de 3 Hz, un clignotement
  // peut declencher une crise chez une personne photosensible. MIN_HOLD_MS
  // plafonne l'alternance a 2 Hz, et le moteur borne en plus a l'execution.
  for (const scenario of SCENARIOS) {
    for (const frame of firstFrames(scenario)) {
      assert.ok(
        frame.holdMs >= MIN_HOLD_MS,
        scenario.id + ' annonce ' + frame.holdMs + ' ms, sous le plancher de ' + MIN_HOLD_MS,
      );
    }
  }
});

test('chaque image porte au moins une consigne', () => {
  for (const scenario of SCENARIOS) {
    for (const frame of firstFrames(scenario)) {
      assert.ok(frame.cues.length >= 1, scenario.id + ' produit une image sans consigne');
      assert.ok(frame.cues.length <= scenario.roles, scenario.id + ' produit plus de consignes que de roles');
    }
  }
});

test('un scenario a deux roles reste jouable sur une seule ampoule', () => {
  // Le moteur ne retient que la premiere consigne quand il n'a qu'une lampe :
  // celle-ci doit donc suffire a produire quelque chose de visible, sinon le
  // scenario paraitrait muet chez la majorite des utilisateurs.
  for (const scenario of SCENARIOS.filter((s) => s.roles === 2)) {
    const premiers = firstFrames(scenario, 4).map((f) => JSON.stringify(f.cues[0]));
    assert.ok(new Set(premiers).size > 1, scenario.id + ' est fige quand on ne joue que son premier role');
  }
});

test('les couleurs restent dans les bornes du modele TSV', () => {
  for (const scenario of SCENARIOS) {
    for (const frame of firstFrames(scenario)) {
      for (const cue of frame.cues) {
        if (!cue.color) continue;
        const { h, s, v } = cue.color;
        assert.ok(h >= 0 && h < 360, scenario.id + ' teinte hors bornes : ' + h);
        assert.ok(s >= 0 && s <= 100, scenario.id + ' saturation hors bornes : ' + s);
        assert.ok(v >= 0 && v <= 100, scenario.id + ' valeur hors bornes : ' + v);
      }
      for (const cue of frame.cues) {
        if (cue.brightness === undefined) continue;
        assert.ok(cue.brightness >= 1 && cue.brightness <= 100, scenario.id + ' intensite hors bornes');
      }
    }
  }
});

test('un scenario qui ne boucle pas annonce combien d images il dure', () => {
  for (const scenario of SCENARIOS.filter((s) => !s.loops)) {
    assert.equal(typeof scenario.steps, 'number', scenario.id + ' sans nombre d images');
    assert.ok(scenario.steps > 0, scenario.id + ' avec un nombre d images nul');
  }
});

test('le lever de soleil va bien du sombre au plein jour', () => {
  const sunrise = byId('lever-de-soleil');
  const debut = sunrise.frame(0).cues[0].color;
  const fin = sunrise.frame(sunrise.steps - 1).cues[0].color;

  assert.ok(fin.v > debut.v + 50, "l'intensite doit monter franchement");
  assert.ok(fin.s < debut.s, 'la couleur doit se desaturer vers le blanc');
  assert.ok(fin.h > debut.h, 'la teinte doit passer de la braise au blanc chaud');
});

test('l alerte alterne bien eclat et extinction', () => {
  const alerte = byId('alerte');
  assert.equal(alerte.frame(0).cues[0].on, true, 'la premiere image doit allumer');
  assert.equal(alerte.frame(1).cues[0].on, false, 'la seconde doit eteindre');
  assert.equal(alerte.steps, 6, 'trois eclats font six images');
});

// --- Jouer ensemble ----------------------------------------------------------

/** Les images d'un scenario joue en groupe sur `count` lampes. */
const groupFrames = (scenario, count, steps = 60) =>
  Array.from({ length: steps }, (_, step) => frameFor(scenario, step, count, true));

const isLit = (cue) => cue.on !== false && (cue.color === undefined || cue.color.v > 30);

test('ensemble, chaque scenario donne une consigne a CHAQUE lampe, sans descendre sous la duree minimale', () => {
  for (const scenario of SCENARIOS) {
    for (const count of [2, 3, 5]) {
      for (const frame of groupFrames(scenario, count)) {
        assert.equal(frame.cues.length, count, scenario.id + ' sur ' + count + ' lampes');
        assert.ok(frame.holdMs >= MIN_HOLD_MS, scenario.id);
        for (const cue of frame.cues) {
          if (!cue.color) continue;
          assert.ok(cue.color.h >= 0 && cue.color.h < 360, scenario.id + ' teinte');
          assert.ok(cue.color.s >= 0 && cue.color.s <= 100 && cue.color.v >= 0 && cue.color.v <= 100, scenario.id + ' bornes');
        }
      }
    }
  }
});

test('sans la case cochee, rien ne change : chaque lampe joue le scenario d origine', () => {
  for (const scenario of SCENARIOS.filter((s) => s.id !== 'bougie')) {
    for (let step = 0; step < 20; step += 1) {
      assert.deepEqual(frameFor(scenario, step, 3, false), scenario.frame(step), scenario.id);
    }
  }
});

test('avec une seule lampe, jouer ensemble n a pas de sens : on retombe sur le scenario d origine', () => {
  for (const scenario of SCENARIOS.filter((s) => s.id !== 'bougie')) {
    assert.deepEqual(frameFor(scenario, 4, 1, true), scenario.frame(4), scenario.id);
  }
});

test('le chenillard allume UNE lampe a la fois, et la lumiere passe de l une a l autre', () => {
  const frames = groupFrames(byId('clignotement'), 3, 6);
  for (const frame of frames) assert.equal(frame.cues.filter(isLit).length, 1);
  const lit = frames.map((frame) => frame.cues.findIndex(isLit));
  assert.deepEqual(lit, [0, 1, 2, 0, 1, 2]);
});

test('l arc-en-ciel ensemble etale des teintes differentes sur les lampes', () => {
  for (const frame of groupFrames(byId('arc-en-ciel'), 3, 10)) {
    const hues = frame.cues.map((cue) => cue.color.h);
    assert.equal(new Set(hues).size, 3);
  }
});

test('le gyrophare ensemble fait faire au rouge le tour de TOUTES les lampes', () => {
  const frames = groupFrames(byId('gyrophare'), 4, 4);
  const redAt = frames.map((frame) => frame.cues.findIndex((cue) => cue.color?.h === 0));
  assert.deepEqual([...redAt].sort(), [0, 1, 2, 3]);
  for (const frame of frames) assert.equal(frame.cues.filter((cue) => cue.color?.h === 0).length, 1);
});

test('la respiration ensemble est une vague : les lampes ne sont pas au meme niveau', () => {
  const frame = frameFor(byId('respiration'), 3, 3, true);
  assert.ok(new Set(frame.cues.map((cue) => cue.brightness)).size > 1);
});

test('l orage ensemble frappe parfois une seule lampe', () => {
  const flashes = groupFrames(byId('orage'), 4, 80).filter((frame) => frame.cues.some((cue) => cue.color.v === 100));
  assert.ok(flashes.length > 0);
  assert.ok(flashes.some((frame) => frame.cues.filter((cue) => cue.color.v === 100).length === 1));
});

test('l alerte ensemble fait alterner les lampes voisines', () => {
  for (const frame of groupFrames(byId('alerte'), 4, 6)) {
    for (let i = 1; i < 4; i += 1) assert.notEqual(isLit(frame.cues[i]), isLit(frame.cues[i - 1]));
  }
});

test('le lever de soleil ensemble monte en decale, et toutes les lampes finissent en plein jour', () => {
  const sunrise = byId('lever-de-soleil');
  const middle = frameFor(sunrise, 20, 3, true);
  assert.ok(middle.cues[0].color.v > middle.cues[2].color.v, 'la premiere lampe precede la derniere');
  const last = frameFor(sunrise, sunrise.steps - 1, 3, true);
  for (const cue of last.cues) assert.equal(cue.color.v, 100);
});
