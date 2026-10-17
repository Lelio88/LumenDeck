/**
 * Verifie le client de l'API Twitch (Helix). Aucun reseau : `fetch` est un faux.
 *
 * Ce qui casse en silence : une requete qui part avec le mauvais compte, une
 * recompense creee sans saisie obligatoire (le viewer ne pourrait rien taper),
 * un remboursement qui valide a la place, ou un jeton qui fuit dans une erreur.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { CLIENT_ID } from '../../twitch/auth.ts';
import {
  HelixError, createReward, deleteReward, listOwnRewards, listPendingRedemptions, settleRedemption, settleWithRetry, subscribeToRedemptions,
} from '../../twitch/helix.ts';

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function fakeFetch(...responses) {
  const calls = [];
  const fetcher = async (url, init) => {
    const next = responses.shift();
    calls.push({ url: new URL(String(url)), method: init?.method ?? 'GET', headers: init?.headers ?? {}, body: init?.body ? JSON.parse(init.body) : undefined });
    if (!next) throw new Error('appel inattendu');
    return next;
  };
  return { fetcher, calls };
}

const SESSION = { accessToken: 'AT', userId: '1337' };

const DEFINITION = { title: 'Choisis la couleur', cost: 200, prompt: 'Tape un nom de couleur', cooldownSeconds: 60, perUserPerStream: 3 };

test('toute requete porte le jeton et l identifiant d application', async () => {
  const { fetcher, calls } = fakeFetch(json(200, { data: [] }));
  await listOwnRewards(SESSION, fetcher);
  assert.equal(calls[0].headers.Authorization, 'Bearer AT');
  assert.equal(calls[0].headers['Client-Id'], CLIENT_ID);
});

test('on ne liste que les recompenses que le plugin peut gerer', async () => {
  const { fetcher, calls } = fakeFetch(json(200, { data: [{ id: 'rw-1', title: 'Choisis la couleur', cost: 200, prompt: 'p', is_enabled: true }] }));
  const rewards = await listOwnRewards(SESSION, fetcher);
  assert.equal(calls[0].url.pathname, '/helix/channel_points/custom_rewards');
  assert.equal(calls[0].url.searchParams.get('broadcaster_id'), '1337');
  assert.equal(calls[0].url.searchParams.get('only_manageable_rewards'), 'true');
  assert.deepEqual(rewards, [{ id: 'rw-1', title: 'Choisis la couleur', cost: 200, prompt: 'p', isEnabled: true }]);
});

test('une recompense a saisie est creee avec saisie OBLIGATOIRE, cooldown et quota', async () => {
  const { fetcher, calls } = fakeFetch(json(200, { data: [{ id: 'rw-9', title: DEFINITION.title, cost: 200, prompt: DEFINITION.prompt, is_enabled: true }] }));
  const reward = await createReward(SESSION, DEFINITION, fetcher);
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].url.searchParams.get('broadcaster_id'), '1337');
  assert.deepEqual(calls[0].body, {
    title: 'Choisis la couleur',
    cost: 200,
    prompt: 'Tape un nom de couleur',
    is_user_input_required: true,
    is_global_cooldown_enabled: true,
    global_cooldown_seconds: 60,
    is_max_per_user_per_stream_enabled: true,
    max_per_user_per_stream: 3,
    should_redemptions_skip_request_queue: false,
  });
  assert.equal(reward.id, 'rw-9');
});

test('sans cooldown ni quota, ils ne sont pas actives', async () => {
  const { fetcher, calls } = fakeFetch(json(200, { data: [{ id: 'rw-9', title: 't', cost: 1, prompt: '', is_enabled: true }] }));
  await createReward(SESSION, { title: 't', cost: 1, prompt: '' }, fetcher);
  assert.equal(calls[0].body.is_global_cooldown_enabled, false);
  assert.equal(calls[0].body.is_max_per_user_per_stream_enabled, false);
  assert.equal('global_cooldown_seconds' in calls[0].body, false);
});

test('une recompense du meme nom est signalee comme doublon', async () => {
  const { fetcher } = fakeFetch(json(400, { error: 'Bad Request', status: 400, message: 'CREATE_CUSTOM_REWARD_DUPLICATE_REWARD' }));
  await assert.rejects(createReward(SESSION, DEFINITION, fetcher), (e) => e instanceof HelixError && e.code === 'duplicate');
});

test('une recompense supprimee vise la bonne chaine et le bon identifiant', async () => {
  const { fetcher, calls } = fakeFetch(new Response(null, { status: 204 }));
  await deleteReward(SESSION, 'rw-1', fetcher);
  assert.equal(calls[0].method, 'DELETE');
  assert.equal(calls[0].url.searchParams.get('id'), 'rw-1');
  assert.equal(calls[0].url.searchParams.get('broadcaster_id'), '1337');
});

test('rembourser envoie CANCELED, valider envoie FULFILLED', async () => {
  const { fetcher, calls } = fakeFetch(json(200, { data: [] }), json(200, { data: [] }));
  await settleRedemption(SESSION, { redemptionId: 'r-1', rewardId: 'rw-1' }, 'refund', fetcher);
  await settleRedemption(SESSION, { redemptionId: 'r-1', rewardId: 'rw-1' }, 'fulfil', fetcher);
  assert.equal(calls[0].method, 'PATCH');
  assert.equal(calls[0].url.pathname, '/helix/channel_points/custom_rewards/redemptions');
  assert.equal(calls[0].url.searchParams.get('id'), 'r-1');
  assert.equal(calls[0].url.searchParams.get('reward_id'), 'rw-1');
  assert.equal(calls[0].url.searchParams.get('broadcaster_id'), '1337');
  assert.deepEqual(calls[0].body, { status: 'CANCELED' });
  assert.deepEqual(calls[1].body, { status: 'FULFILLED' });
});

test('les codes de refus de Twitch sont classes', async () => {
  const cases = [[401, 'unauthorized'], [403, 'forbidden'], [404, 'not-found'], [429, 'rate-limited'], [500, 'network'], [400, 'rejected']];
  for (const [status, code] of cases) {
    const { fetcher } = fakeFetch(json(status, { message: 'x' }));
    await assert.rejects(listOwnRewards(SESSION, fetcher), (e) => e instanceof HelixError && e.code === code, String(status));
  }
});

test('une panne reseau est classee, pas propagee telle quelle', async () => {
  const fetcher = async () => { throw new TypeError('fetch failed'); };
  await assert.rejects(listOwnRewards(SESSION, fetcher), (e) => e instanceof HelixError && e.code === 'network');
});

test('aucune erreur ne contient le jeton', async () => {
  const { fetcher } = fakeFetch(json(401, { message: 'Invalid OAuth token AT' }));
  await assert.rejects(listOwnRewards(SESSION, fetcher), (e) => !String(e.message).includes('AT'));
});

test('une reponse sans liste est invalide', async () => {
  const { fetcher } = fakeFetch(json(200, { data: 'non' }));
  await assert.rejects(listOwnRewards(SESSION, fetcher), (e) => e instanceof HelixError && e.code === 'invalid-response');
});

test('l abonnement aux rachats vise UNE recompense et la session de la socket', async () => {
  // Filtrer sur la recompense : le plugin ne recoit pas le texte saisi pour les autres.
  const { fetcher, calls } = fakeFetch(json(202, { data: [{ id: 'sub-1' }] }));
  await subscribeToRedemptions(SESSION, { sessionId: 'S1', rewardId: 'rw-1' }, fetcher);
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].url.pathname, '/helix/eventsub/subscriptions');
  assert.deepEqual(calls[0].body, {
    type: 'channel.channel_points_custom_reward_redemption.add',
    version: '1',
    condition: { broadcaster_user_id: '1337', reward_id: 'rw-1' },
    transport: { method: 'websocket', session_id: 'S1' },
  });
});

test('un abonnement refuse est classe comme les autres appels', async () => {
  const { fetcher } = fakeFetch(json(403, { message: 'subscription missing proper authorization' }));
  await assert.rejects(subscribeToRedemptions(SESSION, { sessionId: 'S1', rewardId: 'rw-1' }, fetcher),
    (e) => e instanceof HelixError && e.code === 'forbidden');
});

test('les rachats restes en attente sont listes pour UNE recompense, avec leur date', async () => {
  const { fetcher, calls } = fakeFetch(json(200, { data: [
    { id: 'r-1', status: 'UNFULFILLED', redeemed_at: '2026-10-17T18:00:00.000Z', reward: { id: 'rw-1' }, user_input: 'rouge' },
  ] }));
  const pending = await listPendingRedemptions(SESSION, 'rw-1', fetcher);
  assert.equal(calls[0].url.pathname, '/helix/channel_points/custom_rewards/redemptions');
  assert.equal(calls[0].url.searchParams.get('reward_id'), 'rw-1');
  assert.equal(calls[0].url.searchParams.get('status'), 'UNFULFILLED');
  assert.equal(calls[0].url.searchParams.get('broadcaster_id'), '1337');
  assert.deepEqual(pending, [{ id: 'r-1', rewardId: 'rw-1', redeemedAt: Date.parse('2026-10-17T18:00:00.000Z') }]);
});

test('un rachat sans date lisible est ecarte plutot que suppose ancien', async () => {
  const { fetcher } = fakeFetch(json(200, { data: [{ id: 'r-1', redeemed_at: 'pas une date', reward: { id: 'rw-1' } }] }));
  assert.deepEqual(await listPendingRedemptions(SESSION, 'rw-1', fetcher), []);
});

const NOWAIT = async () => {};
const REDEMPTION = { redemptionId: 'r-1', rewardId: 'rw-1' };

test('la cloture reessaie sur une panne passagere puis reussit', async () => {
  const { fetcher, calls } = fakeFetch(json(503, {}), json(429, {}), json(200, { data: [] }));
  await settleWithRetry(SESSION, REDEMPTION, 'refund', fetcher, NOWAIT);
  assert.equal(calls.length, 3);
});

test('la cloture attend entre deux tentatives', async () => {
  const waits = [];
  const { fetcher } = fakeFetch(json(503, {}), json(503, {}), json(200, { data: [] }));
  await settleWithRetry(SESSION, REDEMPTION, 'refund', fetcher, async (ms) => { waits.push(ms); });
  assert.equal(waits.length, 2);
  assert.ok(waits[1] > waits[0], 'le delai doit grandir');
});

test('la cloture ne reessaie pas un refus definitif', async () => {
  for (const status of [401, 403, 404, 400]) {
    const { fetcher, calls } = fakeFetch(json(status, {}), json(200, { data: [] }));
    await assert.rejects(settleWithRetry(SESSION, REDEMPTION, 'refund', fetcher, NOWAIT), (e) => e instanceof HelixError, String(status));
    assert.equal(calls.length, 1, 'statut ' + status);
  }
});

test('la cloture abandonne apres trois tentatives', async () => {
  const { fetcher, calls } = fakeFetch(json(503, {}), json(503, {}), json(503, {}), json(200, { data: [] }));
  await assert.rejects(settleWithRetry(SESSION, REDEMPTION, 'refund', fetcher, NOWAIT), (e) => e instanceof HelixError && e.code === 'network');
  assert.equal(calls.length, 3);
});
