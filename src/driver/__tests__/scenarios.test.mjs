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

import { MIN_HOLD_MS, SCENARIOS, byId } from '../../scenarios/catalogue.ts';

/** Les cinquante premieres images d'un scenario, ce qui couvre tous les cycles. */
const firstFrames = (scenario, count = 50) =>
  Array.from({ length: count }, (_, step) => scenario.frame(step));

test('chaque scenario a un identifiant unique', () => {
  const ids = SCENARIOS.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('on retrouve un scenario par son identifiant, et rien d autre', () => {
  assert.equal(byId('gyrophare')?.name, 'Gyrophare');
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
