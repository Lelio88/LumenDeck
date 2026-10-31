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

test('untilStopped attend la fin du scenario en cours, restauration comprise', async () => {
  const { engine, clock, lamps } = setup();
  await engine.start(byId('arc-en-ciel'), [lamp('a')], { maxMs: 2000 });
  let done = false;
  const waiting = engine.untilStopped('a').then(() => { done = true; });
  await clock.advance(1000);
  assert.equal(done, false, 'le scenario tourne encore');
  await clock.advance(2000);
  await waiting;
  assert.equal(done, true);
  // La restauration est faite AVANT que l'attente ne se termine.
  assert.deepEqual(lamps.calls.at(-1), ['a', 'brightness', 40]);
});

test('untilStopped rend la main tout de suite quand rien ne tourne', async () => {
  const { engine } = setup();
  await engine.untilStopped('a');
  await engine.untilStopped(undefined);
});

test('untilStopped se termine aussi sur un arret manuel', async () => {
  const { engine } = setup();
  await engine.start(byId('arc-en-ciel'), [lamp('a')]);
  const waiting = engine.untilStopped('a');
  await engine.stop('a');
  await waiting;
});

// --- Sessions « en direct » : le suivi d'ecran emprunte le meme moteur ---------

/** Une source qui fait glisser la teinte de 10 degres par image, 100 ms par image. */
const drift = (step) => ({
  cues: [{ color: { h: step * 10, s: 50, v: 50 }, keepOn: step > 0 }],
  holdMs: 100,
});

test('une session en direct tourne plus vite qu un scenario, sans jamais s arreter seule', async () => {
  const { engine, lamps, clock } = setup();
  assert.equal(await engine.startLive('ecran', drift, [lamp('a')]), true);
  assert.equal(engine.runningOn('a'), 'ecran');

  lamps.calls.length = 0;
  await clock.advance(1000);
  const colors = lamps.calls.filter((c) => c[1] === 'color');
  assert.ok(colors.length >= 9, 'une image toutes les ~100 ms, pas toutes les 250 ms (' + colors.length + ')');
  assert.equal(engine.runningOn('a'), 'ecran', 'aucune duree limite');
});

test('en direct, la lampe n est allumee qu une fois : ensuite seule la couleur part', async () => {
  const { engine, lamps, clock } = setup();
  await engine.startLive('ecran', drift, [lamp('a')]);
  await clock.advance(500);
  const powers = lamps.calls.filter((c) => c[1] === 'power');
  assert.equal(powers.length, 1, 'un seul ordre d allumage');
});

test('l arret d une session en direct rend la lampe a son etat d avant', async () => {
  const { engine, lamps, clock } = setup();
  await engine.startLive('ecran', drift, [lamp('a')]);
  await clock.advance(300);
  lamps.calls.length = 0;
  await engine.stop('a');
  assert.equal(engine.runningOn('a'), undefined);
  assert.deepEqual(lamps.calls.slice(-3), [['a', 'power', true], ['a', 'temperature', 3000], ['a', 'brightness', 40]]);
  assert.equal(clock.count(), 0, 'aucune minuterie ne survit a l arret');
});

test('un scenario lance sur une lampe suivie par l ecran prend sa place, proprement', async () => {
  const { engine, clock } = setup();
  await engine.startLive('ecran', drift, [lamp('a')]);
  await engine.start(byId('arc-en-ciel'), [lamp('a')]);
  assert.equal(engine.runningOn('a'), 'arc-en-ciel');
  await clock.advance(1000);
  assert.equal(engine.runningOn('a'), 'arc-en-ciel', 'l ancienne session ne reprend pas la main');
});

test('une session en direct dont aucune lampe ne repond se declare non jouee', async () => {
  const { engine } = setup(new Set(['a']));
  assert.equal(await engine.startLive('ecran', drift, [lamp('a')]), false);
});

test('une session en direct a 20 ms par image ne renonce pas apres 60 ms de panne', async () => {
  const down = new Set();
  const { engine, clock } = setup(down);
  await engine.startLive('ecran', () => ({ cues: [{ color: { h: 10, s: 50, v: 50 } }], holdMs: 0 }), [lamp('a')]);
  down.add('a');
  await clock.advance(400); // ~20 images ratees d'affilee
  assert.equal(engine.runningOn('a'), 'ecran', 'une panne breve ne coupe pas le suivi');
  down.delete('a');
  await clock.advance(100);
  assert.equal(engine.runningOn('a'), 'ecran', 'et la lampe revenue est de nouveau servie');
});

test('une panne qui dure finit quand meme par arreter la session en direct', async () => {
  const down = new Set();
  const { engine, clock } = setup(down);
  await engine.startLive('ecran', () => ({ cues: [{ color: { h: 10, s: 50, v: 50 } }], holdMs: 0 }), [lamp('a')]);
  down.add('a');
  await clock.advance(2000);
  assert.equal(engine.runningOn('a'), undefined, 'aucune minuterie ne tourne indefiniment sur une lampe debranchee');
  assert.equal(clock.count(), 0);
});

test('des images au repos entre deux echecs ne remettent pas le compteur de pannes a zero', async () => {
  const down = new Set(['a']);
  const { engine, clock } = setup(down);
  // Une image sur deux est au repos (rien a ecrire) : elles ne doivent compter ni comme reussite ni comme echec.
  await engine.startLive('ecran', (step) => ({
    cues: [step % 2 === 0 ? { color: { h: 10, s: 50, v: 50 } } : { idle: true }],
    holdMs: 0,
  }), [lamp('a')]);
  await clock.advance(10_000);
  assert.equal(engine.runningOn('a'), undefined, 'une lampe morte finit par faire renoncer la session');
});

test('une image entierement au repos ne touche pas la lampe', async () => {
  const { engine, lamps, clock } = setup();
  await engine.startLive('ecran', () => ({ cues: [{ idle: true }], holdMs: 0 }), [lamp('a')]);
  await clock.advance(500);
  assert.equal(lamps.calls.length, 0);
  assert.equal(engine.runningOn('a'), 'ecran', 'et la session vit : le repos n est pas une panne');
});
