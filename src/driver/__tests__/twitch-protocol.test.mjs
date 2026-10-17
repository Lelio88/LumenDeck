/**
 * Verifie la lecture des messages EventSub de Twitch. Aucun reseau, aucun SDK.
 *
 * Ce qui casse en silence : un message d'un autre type pris pour un rachat, un
 * rachat deja traite rejoue, une adresse de reconnexion qui mene hors de
 * Twitch, ou un message illisible qui ferait tomber le plugin.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseMessage } from '../../twitch/protocol.ts';

const REDEMPTION = {
  id: 'r-1',
  broadcaster_user_id: '1337',
  user_id: '42',
  user_login: 'viewer',
  user_name: 'Viewer',
  user_input: 'rouge',
  status: 'unfulfilled',
  reward: { id: 'rw-1', title: 'Choisis la couleur', cost: 200, prompt: 'Un nom de couleur' },
  redeemed_at: '2026-10-17T18:30:00.000Z',
};

const notification = (event, type = 'channel.channel_points_custom_reward_redemption.add') => JSON.stringify({
  metadata: { message_id: 'm', message_type: 'notification', message_timestamp: 't', subscription_type: type, subscription_version: '1' },
  payload: { subscription: { type }, event },
});

test('le message de bienvenue donne la session et le delai de silence', () => {
  const raw = JSON.stringify({
    metadata: { message_type: 'session_welcome' },
    payload: { session: { id: 'S1', keepalive_timeout_seconds: 10, reconnect_url: null } },
  });
  assert.deepEqual(parseMessage(raw), { kind: 'welcome', sessionId: 'S1', keepaliveSeconds: 10 });
});

test('un message de bienvenue sans session est invalide', () => {
  const raw = JSON.stringify({ metadata: { message_type: 'session_welcome' }, payload: {} });
  assert.deepEqual(parseMessage(raw), { kind: 'invalid' });
});

test('le message de maintien de connexion est reconnu', () => {
  const raw = JSON.stringify({ metadata: { message_type: 'session_keepalive' }, payload: {} });
  assert.deepEqual(parseMessage(raw), { kind: 'keepalive' });
});

test('un rachat devient un rachat lisible', () => {
  assert.deepEqual(parseMessage(notification(REDEMPTION)), {
    kind: 'redemption',
    redemption: {
      id: 'r-1', rewardId: 'rw-1', rewardTitle: 'Choisis la couleur', rewardCost: 200, userName: 'Viewer', userInput: 'rouge',
    },
  });
});

test('un rachat sans texte donne un texte vide, pas un indefini', () => {
  const { redemption } = parseMessage(notification({ ...REDEMPTION, user_input: undefined }));
  assert.equal(redemption.userInput, '');
});

test('un rachat deja traite n est pas rejoue', () => {
  assert.deepEqual(parseMessage(notification({ ...REDEMPTION, status: 'fulfilled' })), { kind: 'ignored' });
  assert.deepEqual(parseMessage(notification({ ...REDEMPTION, status: 'canceled' })), { kind: 'ignored' });
});

test('une notification d un autre type est ignoree', () => {
  assert.deepEqual(parseMessage(notification(REDEMPTION, 'channel.follow')), { kind: 'ignored' });
});

test('un rachat incomplet est invalide', () => {
  assert.deepEqual(parseMessage(notification({ ...REDEMPTION, id: undefined })), { kind: 'invalid' });
  assert.deepEqual(parseMessage(notification({ ...REDEMPTION, reward: undefined })), { kind: 'invalid' });
  assert.deepEqual(parseMessage(notification({ ...REDEMPTION, user_input: 42 })), { kind: 'invalid' });
});

test('une demande de reconnexion vers Twitch est suivie', () => {
  const url = 'wss://eventsub.wss.twitch.tv/ws?challenge=abc';
  const raw = JSON.stringify({ metadata: { message_type: 'session_reconnect' }, payload: { session: { reconnect_url: url } } });
  assert.deepEqual(parseMessage(raw), { kind: 'reconnect', url });
});

test('une demande de reconnexion hors de Twitch est refusee', () => {
  for (const url of [
    'wss://evil.example/ws',
    'ws://eventsub.wss.twitch.tv/ws',
    'wss://eventsub.wss.twitch.tv.evil.example/ws',
    'wss://user@evil.example/ws',
    'pas une adresse',
  ]) {
    const raw = JSON.stringify({ metadata: { message_type: 'session_reconnect' }, payload: { session: { reconnect_url: url } } });
    assert.deepEqual(parseMessage(raw), { kind: 'invalid' }, url);
  }
});

test('une revocation rapporte sa raison', () => {
  const raw = JSON.stringify({
    metadata: { message_type: 'revocation' },
    payload: { subscription: { status: 'authorization_revoked' } },
  });
  assert.deepEqual(parseMessage(raw), { kind: 'revoked', reason: 'authorization_revoked' });
});

test('un message illisible ne fait pas tomber le plugin', () => {
  for (const raw of ['', 'pas du json', '[]', 'null', '{"metadata":null}', '{"metadata":{"message_type":42}}']) {
    assert.deepEqual(parseMessage(raw), { kind: 'invalid' }, raw);
  }
});

test('un type de message inconnu est ignore', () => {
  const raw = JSON.stringify({ metadata: { message_type: 'quelque_chose_de_neuf' }, payload: {} });
  assert.deepEqual(parseMessage(raw), { kind: 'ignored' });
});

test('un rachat sans prix lisible compte zero point : la duree tombe au minimum, jamais au-dela', () => {
  const { redemption } = parseMessage(notification({ ...REDEMPTION, reward: { id: 'rw-1', title: 't', cost: 'beaucoup' } }));
  assert.equal(redemption.rewardCost, 0);
});
