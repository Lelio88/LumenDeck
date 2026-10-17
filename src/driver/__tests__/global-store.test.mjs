/**
 * Verifie le magasin des reglages globaux. Aucun SDK : l'entree-sortie est un faux.
 *
 * Ce qui casse en silence : deux modifications simultanees qui lisent le meme
 * etat de depart (la seconde efface la premiere), une cle voisine ecrasee, ou
 * une lecture sans reponse qui bloque toutes les ecritures suivantes.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createGlobalStore } from '../../global-store.ts';

/** Un faux disque, avec une latence qui rend les courses visibles. */
function fakeDisk(initial = {}, delayMs = 5) {
  const disk = { value: structuredClone(initial), writes: 0 };
  const wait = () => new Promise((resolve) => setTimeout(resolve, delayMs));
  return {
    disk,
    io: {
      read: async () => { await wait(); return structuredClone(disk.value); },
      write: async (all) => { await wait(); disk.value = structuredClone(all); disk.writes += 1; },
    },
  };
}

test('deux modifications simultanees de la meme cle se cumulent au lieu de s ecraser', async () => {
  const { disk, io } = fakeDisk({ bulbs: [] });
  const store = createGlobalStore(io);
  // Chacune ajoute son element a la valeur COURANTE, lue dans la file.
  await Promise.all([
    store.update('bulbs', (cur) => [...(cur ?? []), 'a']),
    store.update('bulbs', (cur) => [...(cur ?? []), 'b']),
  ]);
  assert.deepEqual(disk.value.bulbs, ['a', 'b']);
});

test('modifier une cle laisse les autres intactes', async () => {
  const { disk, io } = fakeDisk({ bulbs: ['x'], twitch: { paused: true } });
  const store = createGlobalStore(io);
  await store.update('twitch', () => ({ paused: false }));
  assert.deepEqual(disk.value, { bulbs: ['x'], twitch: { paused: false } });
});

test('rendre undefined supprime la cle', async () => {
  const { disk, io } = fakeDisk({ bulbs: ['x'], twitch: { paused: true } });
  const store = createGlobalStore(io);
  await store.update('twitch', () => undefined);
  assert.deepEqual(disk.value, { bulbs: ['x'] });
});

test('une lecture concurrente d une ecriture ne rend jamais un etat perime', async () => {
  const { io } = fakeDisk({ n: 0 });
  const store = createGlobalStore(io);
  const write = store.update('n', () => 1);
  const read = store.read('n');
  await write;
  assert.equal(await read, 1, 'la lecture, mise dans la file apres l ecriture, la voit');
});

test('une ecriture qui echoue ne bloque pas les suivantes', async () => {
  let failures = 1;
  const disk = { value: {} };
  const io = {
    read: async () => structuredClone(disk.value),
    write: async (all) => { if (failures-- > 0) throw new Error('disque plein'); disk.value = all; },
  };
  const store = createGlobalStore(io);
  await assert.rejects(store.update('a', () => 1), /disque plein/);
  await store.update('a', () => 2);
  assert.deepEqual(disk.value, { a: 2 });
});

test('une lecture sans reponse est abandonnee et ne bloque pas la file', async () => {
  let hang = true;
  const disk = { value: { a: 1 } };
  const io = {
    read: () => (hang ? new Promise(() => {}) : Promise.resolve(structuredClone(disk.value))),
    write: async (all) => { disk.value = all; },
  };
  const store = createGlobalStore(io, { readTimeoutMs: 20 });
  await assert.rejects(store.update('a', () => 2), /delai/);
  hang = false;
  await store.update('a', () => 3);
  assert.deepEqual(disk.value, { a: 3 });
});

test('un disque vide ou illisible est traite comme un objet vide', async () => {
  const disk = { value: undefined };
  const io = { read: async () => disk.value, write: async (all) => { disk.value = all; } };
  const store = createGlobalStore(io);
  await store.update('a', () => 1);
  assert.deepEqual(disk.value, { a: 1 });
});
