/**
 * Verifie ce qu'une face d'action doit montrer. Aucun SDK, aucune ampoule.
 *
 * Le premier test est une REGRESSION : avec une lampe verte, une touche reglee
 * sur violet s'affichait en vert, comme sa voisine reglee sur vert. Deux touches
 * pointant la meme ampoule devenaient indistinguables, et c'est justement apres
 * en avoir presse une que le defaut se voyait.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { faceValue, isDial } from '../../actions/face.ts';

const VERT = { h: 120, s: 100, v: 100 };
const VIOLET = { h: 280, s: 100, v: 100 };

/** Une molette : setFeedback n'existe que sur l'ecran du Stream Deck+. */
const molette = { setFeedback: async () => {} };
/** Une touche : pas d'ecran, donc pas de setFeedback. */
const touche = {};

test('une touche montre SA valeur, meme quand la lampe en affiche une autre', () => {
  // Arrange : lampe verte, touche reglee sur violet.
  // Act
  const face = faceValue(touche, VERT, VIOLET);
  // Assert
  assert.deepEqual(face, VIOLET, 'la touche doit annoncer ce que l appui appliquera');
});

test('deux touches sur la meme lampe restent distinguables', () => {
  // Arrange : la lampe est verte parce qu on vient de presser la touche verte.
  // Act
  const verte = faceValue(touche, VERT, VERT);
  const violette = faceValue(touche, VERT, VIOLET);
  // Assert
  assert.notDeepEqual(verte, violette);
});

test('une molette suit la lampe : la rotation part de sa valeur courante', () => {
  // Act
  const face = faceValue(molette, VERT, VIOLET);
  // Assert
  assert.deepEqual(face, VERT);
});

test('une molette retombe sur la valeur choisie quand la lampe n en a pas', () => {
  // Arrange : ampoule en blanc, donc aucune couleur courante.
  // Act
  const face = faceValue(molette, null, VIOLET);
  // Assert
  assert.deepEqual(face, VIOLET);
});

test('la regle vaut pour un nombre comme pour une couleur', () => {
  // Arrange : la temperature de blanc porte exactement le meme defaut.
  // Act + Assert
  assert.equal(faceValue(touche, 4000, 2700), 2700, 'touche : sa propre temperature');
  assert.equal(faceValue(molette, 4000, 2700), 4000, 'molette : celle de la lampe');
});

test('une molette se reconnait a son ecran, une touche n en a pas', () => {
  assert.equal(isDial(molette), true);
  assert.equal(isDial(touche), false);
});
