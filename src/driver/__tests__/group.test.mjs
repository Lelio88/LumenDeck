/**
 * Verifie la designation de plusieurs ampoules par une touche. Aucun SDK, aucune ampoule.
 *
 * Ce qui casse en silence : une touche d'une ancienne version dont l'unique
 * ampoule serait oubliee, une meme lampe comptee deux fois (elle recevrait deux
 * fois la consigne), une panne isolee qui empecherait les autres lampes d'obeir.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { adoptGroup, fanOut, nextPower, selectedIds } from '../../actions/group.ts';

test('une touche neuve designe les ampoules cochees, dans l ordre', () => {
  assert.deepEqual(selectedIds({ deviceIds: ['b', 'a'] }), ['b', 'a']);
});

test('une touche d ancienne version garde son ampoule', () => {
  assert.deepEqual(selectedIds({ deviceId: 'a' }), ['a']);
});

test('une touche scenario d ancienne version garde ses deux ampoules, dans l ordre des roles', () => {
  assert.deepEqual(selectedIds({ deviceId: 'a', deviceId2: 'b' }), ['a', 'b']);
});

test('la liste cochee l emporte sur les anciens champs', () => {
  assert.deepEqual(selectedIds({ deviceIds: ['c'], deviceId: 'a', deviceId2: 'b' }), ['c']);
});

test('une meme ampoule n est jamais comptee deux fois', () => {
  assert.deepEqual(selectedIds({ deviceIds: ['a', 'a', 'b'] }), ['a', 'b']);
  assert.deepEqual(selectedIds({ deviceId: 'a', deviceId2: 'a' }), ['a']);
});

test('les valeurs illisibles sont ecartees plutot que propagees', () => {
  assert.deepEqual(selectedIds({ deviceIds: ['a', '', 7, null, 'b'] }), ['a', 'b']);
  assert.deepEqual(selectedIds({ deviceIds: 'a' }), []);
  assert.deepEqual(selectedIds({}), []);
});

test('une liste cochee vide retombe sur l ancien champ', () => {
  // Le panneau ecrit [] quand on decoche tout : l'utilisateur n'a plus rien de
  // choisi, mais une touche qui garde un `deviceId` ancien ne doit pas l'ignorer.
  assert.deepEqual(selectedIds({ deviceIds: [], deviceId: 'a' }), ['a']);
});

test('adoptGroup recopie les anciens champs dans la liste, une seule fois', async () => {
  // Arrange
  const written = [];
  const action = { setSettings: async (s) => { written.push(s); } };
  // Act
  await adoptGroup(action, { deviceId: 'a', deviceId2: 'b', localKey: 'k' });
  // Assert : la liste est posee, les anciens champs d'ampoule disparaissent, le reste survit.
  assert.deepEqual(written, [{ localKey: 'k', deviceIds: ['a', 'b'] }]);
});

test('adoptGroup ne touche pas une touche deja a jour ni une touche sans ampoule', async () => {
  const written = [];
  const action = { setSettings: async (s) => { written.push(s); } };
  await adoptGroup(action, { deviceIds: ['a'] });
  await adoptGroup(action, { color: '#ff0000' });
  assert.deepEqual(written, []);
});

test('fanOut rend les valeurs dans l ordre et ne perd aucune panne', async () => {
  // Arrange : la lampe b est debranchee.
  const op = async (id) => {
    if (id === 'b') throw new Error('hors ligne');
    return id.toUpperCase();
  };
  // Act
  const { values, errors } = await fanOut(['a', 'b', 'c'], op);
  // Assert : a et c ont obei, b est nommee.
  assert.deepEqual(values, ['A', 'C']);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].item, 'b');
  assert.equal(errors[0].error.message, 'hors ligne');
});

test('fanOut lance toutes les lampes sans attendre la precedente', async () => {
  // Arrange : chaque operation attend que les trois aient demarre.
  let started = 0;
  const op = async () => {
    started += 1;
    while (started < 3) await new Promise((r) => setImmediate(r));
    return true;
  };
  // Act + Assert : sequentiel, ce test ne finirait jamais.
  const { values } = await fanOut(['a', 'b', 'c'], op);
  assert.equal(values.length, 3);
});

test('nextPower eteint le groupe des qu une lampe est allumee', () => {
  assert.equal(nextPower([true, false, false]), false);
  assert.equal(nextPower([true, true]), false);
});

test('nextPower allume le groupe quand tout est eteint', () => {
  assert.equal(nextPower([false, false]), true);
  assert.equal(nextPower([]), true);
});

test('fanOut avec delai de grace ne attend pas la lampe muette', async () => {
  // Arrange : a repond tout de suite, b ne repond qu'apres 400 ms (lampe debranchee).
  const op = (id) => new Promise((resolve) => setTimeout(() => resolve(id), id === 'b' ? 400 : 0));
  const started = Date.now();
  // Act
  const { values, errors } = await fanOut(['a', 'b'], op, { graceMs: 20 });
  // Assert : on repart avec a, sans attendre b et sans la compter comme une panne.
  assert.deepEqual(values, ['a']);
  assert.deepEqual(errors, []);
  assert.ok(Date.now() - started < 300, 'la relecture a attendu la lampe muette');
});

test('fanOut avec delai de grace garde les lampes qui repondent dans le delai, dans l ordre', async () => {
  const op = (id) => new Promise((resolve) => setTimeout(() => resolve(id), id === 'a' ? 10 : 0));
  const { values } = await fanOut(['a', 'b', 'c'], op, { graceMs: 100 });
  assert.deepEqual(values, ['a', 'b', 'c']);
});

test('fanOut avec delai de grace attend tout le monde tant que personne n a repondu', async () => {
  // Aucune reussite : le delai de grace ne court pas, une panne doit etre rapportee.
  const op = async () => { throw new Error('hors ligne'); };
  const { values, errors } = await fanOut(['a', 'b'], op, { graceMs: 10 });
  assert.deepEqual(values, []);
  assert.equal(errors.length, 2);
});

test('fanOut avec delai de grace ne laisse pas de rejet non gere derriere lui', async () => {
  // La lampe muette finit par echouer apres qu'on est reparti : sans garde, Node
  // tuerait le processus du plugin sur un rejet non gere.
  let unhandled = 0;
  const onUnhandled = () => { unhandled += 1; };
  process.on('unhandledRejection', onUnhandled);
  const op = (id) => new Promise((resolve, reject) =>
    setTimeout(() => (id === 'b' ? reject(new Error('tard')) : resolve(id)), id === 'b' ? 60 : 0));
  await fanOut(['a', 'b'], op, { graceMs: 5 });
  await new Promise((r) => setTimeout(r, 120));
  process.off('unhandledRejection', onUnhandled);
  assert.equal(unhandled, 0);
});
