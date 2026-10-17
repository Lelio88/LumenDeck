/**
 * Verifie le cycle de vie de la connexion temps reel a Twitch (EventSub).
 * Aucun reseau : la socket et l'horloge sont des faux que le test pilote.
 *
 * Ce qui casse en silence : une connexion morte qu'on croit vivante (plus aucun
 * rachat n'arrive, sans le moindre message), une reconnexion qui boucle a toute
 * vitesse sur un jeton refuse, ou une demande de reconnexion qui coupe l'ancienne
 * socket avant que la nouvelle ne soit prete (rachats perdus).
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { EVENTSUB_URL, createEventSubClient } from '../../twitch/eventsub.ts';

/** Une horloge qu'on avance a la main. */
function fakeTimers() {
  let now = 0;
  const pending = new Map();
  let nextId = 1;
  return {
    set: (fn, ms) => { const id = nextId++; pending.set(id, { fn, at: now + ms }); return id; },
    clear: (id) => { pending.delete(id); },
    /** Avance l'horloge en declenchant ce qui arrive a echeance, dans l'ordre. */
    advance(ms) {
      const target = now + ms;
      for (;;) {
        const due = [...pending.entries()].filter(([, t]) => t.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        pending.delete(due[0]);
        now = due[1].at;
        due[1].fn();
      }
      now = target;
    },
    count: () => pending.size,
  };
}

function setup(over = {}) {
  const timers = fakeTimers();
  const sockets = [];
  const states = [];
  const redemptions = [];
  const subscribed = [];
  const client = createEventSubClient({
    openSocket: (url) => {
      const socket = { url, closed: undefined, close(code) { this.closed = code ?? 1000; } };
      sockets.push(socket);
      return socket;
    },
    subscribe: async (sessionId) => { subscribed.push(sessionId); return 'ok'; },
    onRedemption: (r) => redemptions.push(r),
    onState: (s) => states.push(s),
    timers,
    ...over,
  });
  const say = (socket, message) => socket.onmessage({ data: JSON.stringify(message) });
  const welcome = (socket, id = 'S1', keepalive = 10) =>
    say(socket, { metadata: { message_type: 'session_welcome' }, payload: { session: { id, keepalive_timeout_seconds: keepalive } } });
  const flush = () => new Promise((resolve) => setImmediate(resolve));
  return { client, timers, sockets, states, redemptions, subscribed, say, welcome, flush };
}

const REDEMPTION_MESSAGE = {
  metadata: { message_type: 'notification', subscription_type: 'channel.channel_points_custom_reward_redemption.add' },
  payload: { event: { id: 'r-1', user_name: 'V', user_input: 'rouge', status: 'unfulfilled', reward: { id: 'rw', title: 't' } } },
};

test('on se connecte a Twitch, on s abonne a la bienvenue, puis on est connecte', async () => {
  const t = setup();
  t.client.start();
  assert.equal(t.sockets[0].url, EVENTSUB_URL);
  assert.deepEqual(t.states, ['connecting']);
  t.welcome(t.sockets[0]);
  await t.flush();
  assert.deepEqual(t.subscribed, ['S1']);
  assert.deepEqual(t.states, ['connecting', 'connected']);
});

test('un rachat recu est transmis', async () => {
  const t = setup();
  t.client.start();
  t.welcome(t.sockets[0]);
  await t.flush();
  t.say(t.sockets[0], REDEMPTION_MESSAGE);
  assert.equal(t.redemptions.length, 1);
  assert.equal(t.redemptions[0].userInput, 'rouge');
});

test('un message illisible ne casse rien', async () => {
  const t = setup();
  t.client.start();
  t.sockets[0].onmessage({ data: 'pas du json' });
  t.sockets[0].onmessage({ data: 42 });
  t.welcome(t.sockets[0]);
  await t.flush();
  assert.deepEqual(t.states.at(-1), 'connected');
});

test('un long silence est une connexion morte : on se reconnecte et on se reabonne', async () => {
  const t = setup();
  t.client.start();
  t.welcome(t.sockets[0], 'S1', 10);
  await t.flush();
  // Silence de 10 s + marge : le chien de garde se declenche.
  t.timers.advance(12_500);
  assert.equal(t.sockets[0].closed !== undefined, true);
  assert.equal(t.states.at(-1), 'reconnecting');
  t.timers.advance(1_000);
  assert.equal(t.sockets.length, 2);
  t.welcome(t.sockets[1], 'S2');
  await t.flush();
  assert.deepEqual(t.subscribed, ['S1', 'S2']);
  assert.equal(t.states.at(-1), 'connected');
});

test('chaque message remet le chien de garde a zero', async () => {
  const t = setup();
  t.client.start();
  t.welcome(t.sockets[0], 'S1', 10);
  await t.flush();
  t.timers.advance(8_000);
  t.say(t.sockets[0], { metadata: { message_type: 'session_keepalive' }, payload: {} });
  t.timers.advance(8_000);
  assert.equal(t.sockets[0].closed, undefined);
});

test('une fermeture par Twitch relance la connexion, avec un delai qui grandit', async () => {
  const t = setup();
  t.client.start();
  t.sockets[0].onclose({ code: 4000 });
  assert.equal(t.states.at(-1), 'reconnecting');
  t.timers.advance(1_000);
  assert.equal(t.sockets.length, 2);
  t.sockets[1].onclose({ code: 4000 });
  t.timers.advance(1_000);
  assert.equal(t.sockets.length, 2, 'le second delai doit etre plus long que le premier');
  t.timers.advance(1_000);
  assert.equal(t.sockets.length, 3);
});

test('le delai de reconnexion est plafonne', async () => {
  const t = setup();
  t.client.start();
  for (let i = 0; i < 12; i += 1) {
    t.sockets.at(-1).onclose({ code: 4000 });
    t.timers.advance(60_000);
  }
  const before = t.sockets.length;
  t.sockets.at(-1).onclose({ code: 4000 });
  t.timers.advance(60_000);
  assert.equal(t.sockets.length, before + 1, 'le plafond ne doit pas depasser 60 s');
});

test('une connexion reussie remet le delai a son minimum', async () => {
  const t = setup();
  t.client.start();
  t.sockets[0].onclose({ code: 4000 });
  t.timers.advance(1_000);
  t.sockets[1].onclose({ code: 4000 });
  t.timers.advance(2_000);
  t.welcome(t.sockets[2]);
  await t.flush();
  t.sockets[2].onclose({ code: 4000 });
  t.timers.advance(1_000);
  assert.equal(t.sockets.length, 4);
});

test('la demande de reconnexion ouvre la nouvelle socket SANS fermer l ancienne ni se reabonner', async () => {
  const t = setup();
  t.client.start();
  t.welcome(t.sockets[0]);
  await t.flush();
  const url = 'wss://eventsub.wss.twitch.tv/ws?challenge=abc';
  t.say(t.sockets[0], { metadata: { message_type: 'session_reconnect' }, payload: { session: { reconnect_url: url } } });
  assert.equal(t.sockets[1].url, url);
  assert.equal(t.sockets[0].closed, undefined, 'l ancienne socket reste ouverte jusqu a la bienvenue de la nouvelle');
  t.welcome(t.sockets[1], 'S1');
  await t.flush();
  assert.notEqual(t.sockets[0].closed, undefined);
  assert.deepEqual(t.subscribed, ['S1'], 'les abonnements sont conserves par Twitch');
  assert.equal(t.states.at(-1), 'connected');
});

test('la fermeture de l ancienne socket apres bascule ne declenche pas de reconnexion', async () => {
  const t = setup();
  t.client.start();
  t.welcome(t.sockets[0]);
  await t.flush();
  t.say(t.sockets[0], { metadata: { message_type: 'session_reconnect' }, payload: { session: { reconnect_url: 'wss://eventsub.wss.twitch.tv/ws?x=1' } } });
  t.welcome(t.sockets[1], 'S1');
  await t.flush();
  t.sockets[0].onclose?.({ code: 1000 });
  // Sous le seuil du chien de garde (12 s) : on ne teste que la fermeture tardive.
  t.timers.advance(5_000);
  assert.equal(t.sockets.length, 2);
});

test('un jeton refuse a l abonnement arrete la boucle et demande une reconnexion du compte', async () => {
  const t = setup({ subscribe: async () => 'auth-needed' });
  t.client.start();
  t.welcome(t.sockets[0]);
  await t.flush();
  assert.equal(t.states.at(-1), 'auth-needed');
  t.timers.advance(300_000);
  assert.equal(t.sockets.length, 1, 'pas de boucle de reconnexion sur un jeton refuse');
});

test('un abonnement qui echoue pour une raison passagere reessaie', async () => {
  let attempts = 0;
  const t = setup({ subscribe: async () => (++attempts === 1 ? 'retry' : 'ok') });
  t.client.start();
  t.welcome(t.sockets[0]);
  await t.flush();
  assert.equal(t.states.at(-1), 'reconnecting');
  t.timers.advance(1_000);
  t.welcome(t.sockets[1], 'S2');
  await t.flush();
  assert.equal(t.states.at(-1), 'connected');
});

test('un abonnement qui plante est traite comme un echec passager, sans exception', async () => {
  let attempts = 0;
  const t = setup({ subscribe: async () => { if (++attempts === 1) throw new Error('boum'); return 'ok'; } });
  t.client.start();
  t.welcome(t.sockets[0]);
  await t.flush();
  assert.equal(t.states.at(-1), 'reconnecting');
});

test('une revocation arrete tout : il faut reautoriser', async () => {
  const t = setup();
  t.client.start();
  t.welcome(t.sockets[0]);
  await t.flush();
  t.say(t.sockets[0], { metadata: { message_type: 'revocation' }, payload: { subscription: { status: 'authorization_revoked' } } });
  assert.equal(t.states.at(-1), 'revoked');
  assert.notEqual(t.sockets[0].closed, undefined);
  t.timers.advance(300_000);
  assert.equal(t.sockets.length, 1);
});

test('stop ferme la socket et plus rien ne se relance', async () => {
  const t = setup();
  t.client.start();
  t.welcome(t.sockets[0]);
  await t.flush();
  t.client.stop();
  assert.notEqual(t.sockets[0].closed, undefined);
  assert.equal(t.states.at(-1), 'stopped');
  t.sockets[0].onclose?.({ code: 1000 });
  t.timers.advance(300_000);
  assert.equal(t.sockets.length, 1);
  assert.equal(t.timers.count(), 0);
});

test('start deux fois ne double pas la connexion', () => {
  const t = setup();
  t.client.start();
  t.client.start();
  assert.equal(t.sockets.length, 1);
});

test('une socket qui ne s ouvre pas est retentee', () => {
  const t = setup();
  t.client.start();
  t.sockets[0].onerror?.({});
  t.sockets[0].onclose({ code: 1006 });
  t.timers.advance(1_000);
  assert.equal(t.sockets.length, 2);
});

test('une bienvenue qui n arrive pas dans les 10 s est une connexion ratee', () => {
  const t = setup();
  t.client.start();
  t.timers.advance(13_000);
  assert.notEqual(t.sockets[0].closed, undefined);
  t.timers.advance(2_000);
  assert.equal(t.sockets.length, 2);
});

test('une socket impossible a ouvrir est retentee et ne fait pas tomber le plugin', () => {
  let attempts = 0;
  const t = setup({
    openSocket: (url) => {
      attempts += 1;
      if (attempts === 1) throw new Error('adresse invalide');
      const socket = { url, closed: undefined, close(code) { this.closed = code ?? 1000; } };
      t.sockets.push(socket);
      return socket;
    },
  });
  t.client.start();
  assert.equal(t.states.at(-1), 'reconnecting');
  t.timers.advance(1_000);
  assert.equal(t.sockets.length, 1);
  assert.equal(t.states.at(-1), 'connecting');
});

test('la nouvelle socket qui echoue avant sa bienvenue ne coupe pas l ancienne, qui fonctionne encore', async () => {
  const t = setup();
  t.client.start();
  t.welcome(t.sockets[0]);
  await t.flush();
  t.say(t.sockets[0], { metadata: { message_type: 'session_reconnect' }, payload: { session: { reconnect_url: 'wss://eventsub.wss.twitch.tv/ws?x=1' } } });
  t.sockets[1].onclose({ code: 1006 });
  assert.equal(t.sockets[0].closed, undefined, 'l ancienne socket reste ouverte');
  assert.equal(t.states.at(-1), 'connected');
  // Elle continue de servir : un rachat qui arrive dessus est transmis.
  t.say(t.sockets[0], REDEMPTION_MESSAGE);
  assert.equal(t.redemptions.length, 1);
});

test('un abonnement qui aboutit apres stop() ne ressuscite rien', async () => {
  let release;
  const t = setup({ subscribe: () => new Promise((resolve) => { release = resolve; }) });
  t.client.start();
  t.welcome(t.sockets[0]);
  t.client.stop();
  release('ok');
  await t.flush();
  assert.equal(t.states.at(-1), 'stopped');
});

test('un message illisible ne remet pas le chien de garde a zero', async () => {
  const t = setup();
  t.client.start();
  t.welcome(t.sockets[0], 'S1', 10);
  await t.flush();
  t.timers.advance(8_000);
  t.sockets[0].onmessage({ data: 'pas du json' });
  t.timers.advance(4_500);
  assert.notEqual(t.sockets[0].closed, undefined, 'la liaison silencieuse doit etre declaree morte a l heure');
});
