/**
 * Verifie l'index des sessions de scenario. Aucun SDK, aucune ampoule.
 *
 * Ce qui casse en silence : une session ecrasee par une autre sur une lampe
 * commune (elle tournerait sans plus etre joignable ni arretable), et un arret
 * qui retire de l'index les lampes d'une session voisine.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createRegistry } from '../../scenarios/sessions.ts';

const session = (name, ...ids) => ({ name, targets: ids.map((id) => ({ id })) });

test('une session est retrouvable depuis chacune de ses lampes', () => {
  const registry = createRegistry();
  const s = session('s', 'a', 'b', 'c');
  registry.add(s);
  assert.equal(registry.get('a'), s);
  assert.equal(registry.get('b'), s);
  assert.equal(registry.get('c'), s);
  assert.equal(registry.get('z'), undefined);
});

test('retirer une session libere toutes ses lampes', () => {
  const registry = createRegistry();
  const s = session('s', 'a', 'b');
  registry.add(s);
  registry.remove(s);
  assert.equal(registry.get('a'), undefined);
  assert.equal(registry.get('b'), undefined);
});

test('retirer une session ne touche pas aux lampes reprises par une autre', () => {
  // Arrange : s2 a repris la lampe c, que s3 partageait avec elle.
  const registry = createRegistry();
  const s3 = session('s3', 'c', 'd');
  const s2 = session('s2', 'b', 'c');
  registry.add(s3);
  registry.add(s2);
  // Act : on arrete l'ancienne session.
  registry.remove(s3);
  // Assert : c appartient toujours a s2, seule d est libre.
  assert.equal(registry.get('c'), s2);
  assert.equal(registry.get('d'), undefined);
});

test('unique rend chaque session une seule fois, quel que soit son nombre de lampes', () => {
  const registry = createRegistry();
  const s1 = session('s1', 'a', 'b', 'c');
  const s2 = session('s2', 'd');
  registry.add(s1);
  registry.add(s2);
  assert.deepEqual(registry.unique(), [s1, s2]);
});
