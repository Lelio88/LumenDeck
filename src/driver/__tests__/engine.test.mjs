/**
 * Verifie le moteur de scenarios dans le temps. Aucune ampoule : de fausses
 * lampes notent ce qu'on leur demande, et l'horloge avance a la main.
 *
 * Ce qui casse en silence : un scenario achete par un viewer qui ne s'arrete
 * jamais, des lampes laissees dans la couleur du dernier eclat au lieu de leur
 * etat d'avant, une minuterie qui survit a l'arret, ou un scenario declare
 * « joue » alors qu'aucune lampe n'a rien recu.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { byId } from '../../scenarios/catalogue.ts';
import { createEngine } from '../../scenarios/engine.ts';

function fakeTimers() {
  let now = 0;
  const pending = new Map();
  let next = 1;
  return {
    now: () => now,
    timers: {
      set: (fn, ms) => { const id = next++; pending.set(id, { fn, at: now + ms }); return id; },
      clear: (id) => { pending.delete(id); },
    },
    count: () => pending.size,
    /** Avance l'horloge en declenchant les echeances dans l'ordre, et laisse les promesses se resoudre. */
    async advance(ms) {
      const target = now + ms;
      for (;;) {
        const due = [...pending.entries()].filter(([, t]) => t.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        pending.delete(due[0]);
        now = due[1].at;
        due[1].fn();
        for (let i = 0; i < 20; i += 1) await new Promise((resolve) => setImmediate(resolve));
      }
      now = target;
    },
  };
}

const INITIAL = { on: true, color: null, temperatureK: 3000, brightness: 40 };

/** Des lampes qui notent les ordres ; celles de `unreachable` echouent toujours. */
function fakeLamps(unreachable = new Set()) {
  const calls = [];
  const withBulb = async (target, op) => {
    if (unreachable.has(target.id)) throw new Error('hors ligne');
    const bulb = {
      read: async () => ({ ...INITIAL }),
      setPower: async (on) => { calls.push([target.id, 'power', on]); },
      setColor: async (color) => { calls.push([target.id, 'color', color.h]); },
      setBrightness: async (level) => { calls.push([target.id, 'brightness', level]); },
      setTemperature: async (kelvin) => { calls.push([target.id, 'temperature', kelvin]); },
    };
    return op(bulb);
  };
  return { calls, withBulb };
}

const lamp = (id) => ({ id, key: 'k' });

function setup(unreachable) {
  const clock = fakeTimers();
  const lamps = fakeLamps(unreachable);
  const engine = createEngine({ withBulb: lamps.withBulb, timers: clock.timers, now: clock.now });
  return { clock, lamps, engine };
}

test('un scenario qui atteint une lampe se declare joue, et tourne', async () => {
  const { engine, lamps, clock } = setup();
  assert.equal(await engine.start(byId('arc-en-ciel'), [lamp('a')]), true);
  assert.equal(engine.runningOn('a'), 'arc-en-ciel');
  assert.ok(lamps.calls.some((c) => c[1] === 'color'));
  assert.equal(clock.count(), 1, 'la prochaine image est programmee');
});

test('un scenario dont AUCUNE lampe ne repond se declare non joue', async () => {
  const { engine } = setup(new Set(['a', 'b']));
  assert.equal(await engine.start(byId('arc-en-ciel'), [lamp('a'), lamp('b')]), false);
});

test('une seule lampe qui repond suffit pour que le scenario joue', async () => {
  const { engine } = setup(new Set(['b']));
  assert.equal(await engine.start(byId('arc-en-ciel'), [lamp('a'), lamp('b')]), true);
});

test('passe la duree maximale, le scenario s arrete et rend aux lampes leur etat d avant', async () => {
  const { engine, lamps, clock } = setup();
  await engine.start(byId('arc-en-ciel'), [lamp('a')], { maxMs: 2000 });
  lamps.calls.length = 0;
  await clock.advance(5000);
  assert.equal(engine.runningOn('a'), undefined);
  // Restauration : allumee, blanc a 3000 K, intensite 40.
  assert.deepEqual(lamps.calls.slice(-3), [['a', 'power', true], ['a', 'temperature', 3000], ['a', 'brightness', 40]]);
  assert.equal(clock.count(), 0, 'aucune minuterie ne survit a l arret');
});

test('une image longue ne fait pas depasser l echeance', async () => {
  // Le lever de soleil tient chaque image 5 s ; une duree de 2 s doit etre tenue.
  const { engine, clock } = setup();
  await engine.start(byId('lever-de-soleil'), [lamp('a')], { maxMs: 2000 });
  await clock.advance(2100);
  assert.equal(engine.runningOn('a'), undefined);
});

test('sans duree maximale, le scenario tourne jusqu a l arret', async () => {
  const { engine, clock } = setup();
  await engine.start(byId('arc-en-ciel'), [lamp('a')]);
  await clock.advance(60_000);
  assert.equal(engine.runningOn('a'), 'arc-en-ciel');
  await engine.stop('a');
  assert.equal(engine.runningOn('a'), undefined);
  assert.equal(clock.count(), 0);
});

test('ensemble, le chenillard allume une seule lampe par image', async () => {
  const { engine, lamps } = setup();
  await engine.start(byId('clignotement'), [lamp('a'), lamp('b'), lamp('c')], { together: true });
  const first = lamps.calls.filter((c) => c[1] === 'power');
  assert.deepEqual(first, [['a', 'power', true], ['b', 'power', false], ['c', 'power', false]]);
});

test('une lampe qui decroche en cours de route arrete le scenario au bout de trois images ratees', async () => {
  const unreachable = new Set();
  const { engine, clock } = setup(unreachable);
  await engine.start(byId('arc-en-ciel'), [lamp('a')]);
  unreachable.add('a');
  await clock.advance(10_000);
  assert.equal(engine.runningOn('a'), undefined);
  assert.equal(clock.count(), 0);
});

test('lancer un scenario sur une lampe occupee arrete et restaure le precedent d abord', async () => {
  const { engine, lamps } = setup();
  await engine.start(byId('arc-en-ciel'), [lamp('a')]);
  lamps.calls.length = 0;
  await engine.start(byId('bougie'), [lamp('a')]);
  assert.equal(engine.runningOn('a'), 'bougie');
  // La restauration (blanc 3000 K) precede la premiere flamme.
  const restoredAt = lamps.calls.findIndex((c) => c[1] === 'temperature');
  const firstFlame = lamps.calls.findIndex((c) => c[1] === 'color');
  assert.ok(restoredAt !== -1 && restoredAt < firstFlame);
});

test('stopAll arrete tout et ne laisse aucune minuterie', async () => {
  const { engine, clock } = setup();
  await engine.start(byId('arc-en-ciel'), [lamp('a')]);
  await engine.start(byId('bougie'), [lamp('b')]);
  await engine.stopAll();
  assert.equal(engine.runningOn('a'), undefined);
  assert.equal(engine.runningOn('b'), undefined);
  assert.equal(clock.count(), 0);
});
