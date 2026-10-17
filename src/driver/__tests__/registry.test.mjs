/**
 * Verifie la fusion des ampoules dans le registre. Aucun SDK.
 *
 * Ce qui casse en silence : une decouverte reseau (qui ignore la cle) qui efface
 * la cle deja saisie, ou un doublon d'ampoule.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { mergeBulb, withoutBulb } from '../../registry.ts';

test('une ampoule nouvelle est ajoutee, cle vide si on ne la connait pas', () => {
  assert.deepEqual(mergeBulb([], { id: 'a', ip: '1.1.1.1' }), [{ id: 'a', key: '', ip: '1.1.1.1' }]);
});

test('une ampoule connue est fusionnee : la cle deja saisie survit a une decouverte', () => {
  const known = [{ id: 'a', key: 'secret', ip: '1.1.1.1', name: 'Bureau' }];
  assert.deepEqual(mergeBulb(known, { id: 'a', ip: '2.2.2.2', version: '3.4' }), [
    { id: 'a', key: 'secret', ip: '2.2.2.2', name: 'Bureau', version: '3.4' },
  ]);
});

test('une nouvelle cle remplace l ancienne', () => {
  assert.equal(mergeBulb([{ id: 'a', key: 'old' }], { id: 'a', key: 'new' })[0].key, 'new');
});

test('la fusion ne modifie pas la liste d origine et ne touche pas les autres ampoules', () => {
  const known = [{ id: 'a', key: 'k' }, { id: 'b', key: 'l' }];
  const next = mergeBulb(known, { id: 'a', name: 'X' });
  assert.deepEqual(known, [{ id: 'a', key: 'k' }, { id: 'b', key: 'l' }]);
  assert.deepEqual(next[1], { id: 'b', key: 'l' });
});

test('oublier une ampoule retire la bonne et seulement elle', () => {
  assert.deepEqual(withoutBulb([{ id: 'a', key: 'k' }, { id: 'b', key: 'l' }], 'a'), [{ id: 'b', key: 'l' }]);
});
