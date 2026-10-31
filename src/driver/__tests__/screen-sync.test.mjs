/**
 * Verifie le suivi d'ecran de bout en bout, sans ecran ni ampoule : un faux
 * capteur parle quand le test le decide, de fausses lampes notent les ordres, et
 * l'horloge avance a la main.
 *
 * Ce qui casse en silence : un capteur qui continue de capturer apres l'arret
 * (l'ecran est lu pour personne), une lampe de droite qui prend la couleur de la
 * gauche, un ordre d'allumage repete a chaque image, une scene stable qui occupe
 * l'ampoule a ne rien dire, et un capteur mort qui laisse les lampes figees.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { byId } from '../../scenarios/catalogue.ts';
import { createEngine } from '../../scenarios/engine.ts';
import { SCREEN_SYNC_ID, createScreenSync } from '../../screen/sync.ts';

function fakeClock() {
  let now = 0;
  const pending = new Map();
  let next = 1;
  return {
    now: () => now,
    timers: {
      set: (fn, ms) => { const id = next++; pending.set(id, { fn, at: now + ms }); return id; },
      clear: (id) => { pending.delete(id); },
    },
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

const INITIAL = { on: false, color: null, temperatureK: 3000, brightness: 40 };

function fakeLamps(unreachable = new Set()) {
  const calls = [];
  const lamps = { calls, opened: 0 };
  const withBulb = async (target, op) => {
    lamps.opened += 1;
    if (unreachable.has(target.id)) throw new Error('hors ligne');
    return op({
      read: async () => ({ ...INITIAL }),
      setPower: async (on) => { calls.push([target.id, 'power', on]); },
      setColor: async (color) => { calls.push([target.id, 'color', color.h]); },
      setBrightness: async (level) => { calls.push([target.id, 'brightness', level]); },
      setTemperature: async (kelvin) => { calls.push([target.id, 'temperature', kelvin]); },
    });
  };
  lamps.withBulb = withBulb;
  return lamps;
}

/** Un capteur factice : le test lui fait dire ce qu'il veut. */
function fakeLauncher(available = true, dieOnLaunch = false) {
  const state = { launched: 0, stopped: 0, options: null, onEvent: null, onExit: null };
  return {
    state,
    launcher: {
      available: () => available,
      launch(options, onEvent, onExit) {
        state.launched += 1;
        state.options = options;
        state.onEvent = onEvent;
        state.onExit = onExit;
        if (dieOnLaunch) onExit();
        // Comme le vrai lanceur, `stop` est idempotent : on compte les capteurs tues, pas les appels.
        let dead = false;
        return { stop: () => { if (!dead) { dead = true; state.stopped += 1; } } };
      },
    },
  };
}

const lamp = (id) => ({ id, key: 'k' });
/** Laisse les promesses en attente se resoudre (un arret demande de l'exterieur n'est pas attendu par le test). */
const settle = async () => { for (let i = 0; i < 20; i += 1) await new Promise((resolve) => setImmediate(resolve)); };
/** Une image du capteur : une couleur par zone. */
const frame = (...zones) => ({ kind: 'frame', zones: zones.map(([r, g, b, v]) => ({ rgb: [r, g, b], v })) });
const RED = [220, 20, 20, 60];
const BLUE = [20, 30, 220, 60];

function setup({ unreachable, available, dieOnLaunch } = {}) {
  const clock = fakeClock();
  const lamps = fakeLamps(unreachable);
  const engine = createEngine({ withBulb: lamps.withBulb, timers: clock.timers, now: clock.now });
  const capture = fakeLauncher(available, dieOnLaunch);
  const sync = createScreenSync({ engine, launcher: capture.launcher });
  return { clock, lamps, engine, capture, sync };
}

const colorsOf = (lamps, id) => lamps.calls.filter((c) => c[0] === id && c[1] === 'color');

test('la lampe prend la couleur de l ecran, allumee une seule fois', async () => {
  const { sync, capture, lamps, clock, engine } = setup();
  assert.equal(await sync.start([lamp('a')], { screen: 'primary', mode: 'same' }), 'started');
  assert.equal(engine.runningOn('a'), SCREEN_SYNC_ID);

  capture.state.onEvent(frame(RED));
  await clock.advance(400);
  assert.ok(colorsOf(lamps, 'a').length >= 1, 'une couleur est partie');
  assert.equal(lamps.calls.filter((c) => c[1] === 'power').length, 1, 'allumee une seule fois');
  const hue = colorsOf(lamps, 'a')[0][2];
  assert.ok(hue < 20 || hue > 340, 'la teinte est rouge');
});

test('une scene stable ne coute aucun ordre de plus', async () => {
  const { sync, capture, lamps, clock } = setup();
  await sync.start([lamp('a')], { screen: 'primary', mode: 'same' });
  capture.state.onEvent(frame(RED));
  await clock.advance(400);
  const before = lamps.calls.length;
  for (let i = 0; i < 10; i += 1) capture.state.onEvent(frame(RED));
  await clock.advance(1000);
  assert.equal(lamps.calls.length, before, 'rien n a change, rien n est envoye');
});

test('en mode zones, chaque moitie des lampes suit sa moitie d ecran', async () => {
  const { sync, capture, lamps, clock } = setup();
  await sync.start([lamp('gauche'), lamp('droite')], { screen: 'primary', mode: 'zones' });
  assert.equal(capture.state.options.zones, 2, 'le capteur mesure deux zones');

  capture.state.onEvent(frame(RED, BLUE));
  await clock.advance(400);
  const left = colorsOf(lamps, 'gauche')[0][2];
  const right = colorsOf(lamps, 'droite')[0][2];
  assert.ok(left < 20 || left > 340, 'gauche : rouge');
  assert.ok(right > 200 && right < 260, 'droite : bleu');
});

test('en mode meme couleur, une seule zone est mesuree et toutes les lampes la partagent', async () => {
  const { sync, capture, lamps, clock } = setup();
  await sync.start([lamp('a'), lamp('b')], { screen: 'primary', mode: 'same' });
  assert.equal(capture.state.options.zones, 1);
  capture.state.onEvent(frame(BLUE));
  await clock.advance(400);
  assert.deepEqual(colorsOf(lamps, 'a')[0].slice(2), colorsOf(lamps, 'b')[0].slice(2));
});

test('une seule lampe en mode zones ne mesure qu une zone', async () => {
  const { sync, capture } = setup();
  await sync.start([lamp('a')], { screen: 'primary', mode: 'zones' });
  assert.equal(capture.state.options.zones, 1);
});

test('l ecran demande est transmis au capteur', async () => {
  const { sync, capture } = setup();
  await sync.start([lamp('a')], { screen: '1', mode: 'same' });
  assert.equal(capture.state.options.screen, '1');
});

test('l arret rend les lampes a leur etat et tue le capteur', async () => {
  const { sync, capture, lamps, clock, engine } = setup();
  const ends = [];
  await sync.start([lamp('a')], { screen: 'primary', mode: 'same' }, (why) => ends.push(why));
  capture.state.onEvent(frame(RED));
  await clock.advance(300);

  await sync.stop('a');
  await clock.advance(10);
  assert.equal(engine.runningOn('a'), undefined);
  assert.equal(capture.state.stopped, 1, 'le capteur est arrete');
  assert.deepEqual(ends, ['stopped']);
  // La lampe etait eteinte avant le suivi : on la rend eteinte.
  assert.deepEqual(lamps.calls.at(-1), ['a', 'power', false]);
});

test('un scenario lance sur la lampe arrete le suivi et son capteur', async () => {
  const { sync, capture, clock, engine } = setup();
  await sync.start([lamp('a')], { screen: 'primary', mode: 'same' });
  await engine.start(byId('arc-en-ciel'), [lamp('a')]);
  await clock.advance(10);
  assert.equal(capture.state.stopped, 1, 'plus personne ne lit l ecran');
  assert.equal(sync.isActive('a'), false);
});

test('un capteur qui meurt arrete le suivi et le dit', async () => {
  const { sync, capture, engine } = setup();
  const ends = [];
  await sync.start([lamp('a')], { screen: 'primary', mode: 'same' }, (why) => ends.push(why));
  capture.state.onExit();
  await settle();
  assert.equal(engine.runningOn('a'), undefined, 'les lampes ne restent pas figees');
  assert.deepEqual(ends, ['capture-failed']);
});

test('sans capteur installe, le suivi se declare indisponible sans toucher aux lampes', async () => {
  const { sync, lamps, capture } = setup({ available: false });
  assert.equal(await sync.start([lamp('a')], { screen: 'primary', mode: 'same' }), 'unavailable');
  assert.equal(lamps.calls.length, 0);
  assert.equal(capture.state.launched, 0);
});

test('si aucune lampe ne repond, le capteur est arrete et rien ne tourne', async () => {
  const { sync, capture, engine } = setup({ unreachable: new Set(['a']) });
  assert.equal(await sync.start([lamp('a')], { screen: 'primary', mode: 'same' }), 'unreached');
  assert.equal(capture.state.stopped, 1);
  assert.equal(engine.runningOn('a'), undefined);
});

test('un message d etat du capteur ne change pas la couleur des lampes', async () => {
  const { sync, capture, lamps, clock } = setup();
  await sync.start([lamp('a')], { screen: 'primary', mode: 'same' });
  capture.state.onEvent({ kind: 'status', status: 'lost' });
  await clock.advance(500);
  assert.equal(colorsOf(lamps, 'a').length, 0);
});

test('une scene stable n ouvre meme pas de connexion aux lampes', async () => {
  const { sync, capture, lamps, clock } = setup();
  await sync.start([lamp('a')], { screen: 'primary', mode: 'same' });
  capture.state.onEvent(frame(RED));
  await clock.advance(400);
  const opened = lamps.opened;
  await clock.advance(1000);
  assert.equal(lamps.opened, opened, 'un ordre vide ne prend pas de connexion du reservoir');
});

test('une ecriture ratee puis une lampe revenue : la couleur repart, lampe rallumee', async () => {
  const down = new Set();
  const { sync, capture, lamps, clock } = setup({ unreachable: down });
  await sync.start([lamp('a')], { screen: 'primary', mode: 'same' });

  down.add('a');
  capture.state.onEvent(frame(RED));
  await clock.advance(80); // une image echoue
  assert.equal(colorsOf(lamps, 'a').length, 0, 'rien n a atteint la lampe');

  down.delete('a');
  await clock.advance(200);
  assert.ok(colorsOf(lamps, 'a').length >= 1, 'la couleur est renvoyee');
  assert.ok(lamps.calls.some((c) => c[1] === 'power' && c[2] === true), 'et la lampe est rallumee');
});

test('si le moteur leve pendant le demarrage, le capteur est tue', async () => {
  const capture = fakeLauncher();
  const sync = createScreenSync({
    engine: { startLive: async () => { throw new Error('boum'); }, stop: async () => {}, runningOn: () => undefined },
    launcher: capture.launcher,
  });
  await assert.rejects(sync.start([lamp('a')], { screen: 'primary', mode: 'same' }), /boum/);
  assert.equal(capture.state.stopped, 1);
});

test('un capteur mort pendant le demarrage ne laisse pas de session fantome', async () => {
  const { sync, engine, clock } = setup({ dieOnLaunch: true });
  const ends = [];
  assert.equal(await sync.start([lamp('a')], { screen: 'primary', mode: 'same' }, (why) => ends.push(why)), 'capture-failed');
  await clock.advance(500);
  assert.equal(engine.runningOn('a'), undefined);
  assert.deepEqual(ends, [], 'l appelant a deja eu sa reponse : pas de seconde annonce');
});

test('un capteur mort pendant qu un scenario occupe la lampe ne coupe pas ce scenario', async () => {
  const { sync, engine } = setup({ dieOnLaunch: true });
  await engine.start(byId('arc-en-ciel'), [lamp('a')]);
  const result = sync.start([lamp('a')], { screen: 'primary', mode: 'same' });
  assert.equal(await result, 'capture-failed');
});

test('un second appui pendant le demarrage annule sans annoncer de panne', async () => {
  const { sync, capture, engine } = setup();
  const ends = [];
  const pending = sync.start([lamp('a')], { screen: 'primary', mode: 'same' }, (why) => ends.push(why));
  await sync.stop('a');
  assert.equal(await pending, 'cancelled');
  assert.equal(capture.state.stopped, 1, 'le capteur est arrete');
  assert.equal(engine.runningOn('a'), undefined);
  assert.deepEqual(ends, []);
});

test('un changement brutal a l ecran devient une rampe de petits pas, pas un saut', async () => {
  const { sync, capture, lamps, clock } = setup();
  await sync.start([lamp('a')], { screen: 'primary', mode: 'same' });
  capture.state.onEvent(frame(RED));
  await clock.advance(300);

  lamps.calls.length = 0;
  for (let i = 0; i < 30; i += 1) {
    capture.state.onEvent(frame(BLUE));
    await clock.advance(100);
  }
  const hues = colorsOf(lamps, 'a').map((c) => c[2]);
  assert.ok(hues.length >= 5, 'plusieurs envois, pas un seul saut (' + hues.length + ')');
  for (let i = 1; i < hues.length; i += 1) {
    const gap = Math.abs(hues[i] - hues[i - 1]);
    assert.ok(Math.min(gap, 360 - gap) <= 15, 'pas de teinte borne : ' + hues[i - 1] + ' -> ' + hues[i]);
  }
  const last = hues.at(-1);
  assert.ok(last > 200 && last < 260, 'et la lampe finit bien sur le bleu (' + last + ')');
});
