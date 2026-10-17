/**
 * Verifie la connexion au compte Twitch (Device Code Grant). Aucun reseau : le
 * `fetch` est un faux qui rejoue des reponses.
 *
 * Ce qui casse en silence : une attente qui boucle sans fin, un jeton
 * rafraichi qu'on oublie de remplacer (Twitch n'accepte un jeton de
 * renouvellement qu'UNE fois), ou un identifiant d'application qui part ailleurs
 * que chez Twitch.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { CLIENT_ID, SCOPES, TwitchAuthError, pollDeviceFlow, refreshTokens, revokeToken, startDeviceFlow } from '../../twitch/auth.ts';

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** Un faux fetch qui rend les reponses dans l'ordre et note les appels. */
function fakeFetch(...responses) {
  const calls = [];
  const fetcher = async (url, init) => {
    calls.push({ url: String(url), body: new URLSearchParams(String(init?.body ?? '')), headers: init?.headers });
    const next = responses.shift();
    if (!next) throw new Error('appel inattendu');
    return next;
  };
  return { fetcher, calls };
}

const TOKEN_BODY = { access_token: 'AT', refresh_token: 'RT', expires_in: 14000, scope: [...SCOPES], token_type: 'bearer' };
const VALIDATE_BODY = { client_id: CLIENT_ID, login: 'lelio', user_id: '1337', scopes: [...SCOPES], expires_in: 14000 };

test('le code d appareil est demande a Twitch avec les deux permissions et rien d autre', async () => {
  // Arrange
  const { fetcher, calls } = fakeFetch(json(200, {
    device_code: 'DC', user_code: 'ABCD1234', verification_uri: 'https://www.twitch.tv/activate?device-code=ABCD1234',
    expires_in: 1800, interval: 5,
  }));
  // Act
  const code = await startDeviceFlow(fetcher);
  // Assert
  assert.equal(calls[0].url, 'https://id.twitch.tv/oauth2/device');
  assert.equal(calls[0].body.get('client_id'), CLIENT_ID);
  assert.equal(calls[0].body.get('scopes'), 'channel:read:redemptions channel:manage:redemptions');
  assert.deepEqual(code, {
    deviceCode: 'DC', userCode: 'ABCD1234',
    verificationUri: 'https://www.twitch.tv/activate?device-code=ABCD1234',
    expiresInSeconds: 1800, intervalSeconds: 5,
  });
});

test('une adresse de verification hors de twitch.tv est refusee', async () => {
  // Le panneau affiche et ouvre cette adresse : elle ne doit mener que chez Twitch.
  const { fetcher } = fakeFetch(json(200, {
    device_code: 'DC', user_code: 'X', verification_uri: 'https://evil.example/activate', expires_in: 1800, interval: 5,
  }));
  await assert.rejects(startDeviceFlow(fetcher), (e) => e instanceof TwitchAuthError && e.code === 'invalid-response');
});

test('un refus de Twitch au depart est rapporte, pas avale', async () => {
  const { fetcher } = fakeFetch(json(400, { status: 400, message: 'invalid client' }));
  await assert.rejects(startDeviceFlow(fetcher), (e) => e instanceof TwitchAuthError && e.code === 'rejected');
});

const DEVICE = { deviceCode: 'DC', userCode: 'U', verificationUri: 'https://www.twitch.tv/activate', expiresInSeconds: 1800, intervalSeconds: 5 };

test('l attente rend les jetons des que le streamer a autorise', async () => {
  // Arrange : deux tours « en attente », puis l'autorisation, puis la validation du jeton.
  const { fetcher, calls } = fakeFetch(
    json(400, { status: 400, message: 'authorization_pending' }),
    json(400, { status: 400, message: 'authorization_pending' }),
    json(200, TOKEN_BODY),
    json(200, VALIDATE_BODY),
  );
  const waits = [];
  // Act
  const tokens = await pollDeviceFlow(DEVICE, { fetcher, sleep: async (ms) => { waits.push(ms); }, now: () => 1_000_000 });
  // Assert : on a respecte l'intervalle annonce, et le compte vient de la validation.
  assert.deepEqual(waits, [5000, 5000, 5000]);
  assert.equal(calls[2].body.get('grant_type'), 'urn:ietf:params:oauth:grant-type:device_code');
  assert.equal(calls[2].body.get('device_code'), 'DC');
  assert.deepEqual(tokens, {
    accessToken: 'AT', refreshToken: 'RT', expiresAt: 1_000_000 + 14000 * 1000, userId: '1337', login: 'lelio',
  });
});

test('slow_down allonge l intervalle', async () => {
  const { fetcher } = fakeFetch(
    json(400, { status: 400, message: 'slow_down' }),
    json(200, TOKEN_BODY),
    json(200, VALIDATE_BODY),
  );
  const waits = [];
  await pollDeviceFlow(DEVICE, { fetcher, sleep: async (ms) => { waits.push(ms); }, now: () => 0 });
  assert.deepEqual(waits, [5000, 10000]);
});

test('le code expire : l attente s arrete avec une raison claire', async () => {
  // Le temps passe de 600 s a chaque lecture de l'horloge : le code (30 min) expire.
  let clock = 0;
  const { fetcher } = fakeFetch(...Array.from({ length: 10 }, () => json(400, { status: 400, message: 'authorization_pending' })));
  await assert.rejects(
    pollDeviceFlow(DEVICE, { fetcher, sleep: async () => {}, now: () => (clock += 600_000) }),
    (e) => e instanceof TwitchAuthError && e.code === 'expired',
  );
});

test('un refus de l autorisation arrete l attente', async () => {
  const { fetcher } = fakeFetch(json(400, { status: 400, message: 'access_denied' }));
  await assert.rejects(
    pollDeviceFlow(DEVICE, { fetcher, sleep: async () => {}, now: () => 0 }),
    (e) => e instanceof TwitchAuthError && e.code === 'rejected',
  );
});

test('l attente peut etre annulee par le panneau', async () => {
  const controller = new AbortController();
  const { fetcher } = fakeFetch(json(400, { status: 400, message: 'authorization_pending' }));
  const run = pollDeviceFlow(DEVICE, {
    fetcher, now: () => 0, signal: controller.signal,
    sleep: async () => { controller.abort(); },
  });
  await assert.rejects(run, (e) => e instanceof TwitchAuthError && e.code === 'cancelled');
});

test('un jeton sans les deux permissions est refuse', async () => {
  const { fetcher } = fakeFetch(
    json(200, TOKEN_BODY),
    json(200, { ...VALIDATE_BODY, scopes: ['channel:read:redemptions'] }),
  );
  await assert.rejects(
    pollDeviceFlow(DEVICE, { fetcher, sleep: async () => {}, now: () => 0 }),
    (e) => e instanceof TwitchAuthError && e.code === 'missing-scope',
  );
});

test('un jeton emis pour une autre application est refuse', async () => {
  const { fetcher } = fakeFetch(json(200, TOKEN_BODY), json(200, { ...VALIDATE_BODY, client_id: 'autre' }));
  await assert.rejects(
    pollDeviceFlow(DEVICE, { fetcher, sleep: async () => {}, now: () => 0 }),
    (e) => e instanceof TwitchAuthError && e.code === 'invalid-response',
  );
});

const OLD = { accessToken: 'AT0', refreshToken: 'RT0', expiresAt: 0, userId: '1337', login: 'lelio' };

test('le renouvellement remplace les DEUX jetons et garde le compte', async () => {
  // Un jeton de renouvellement n'est valable qu'une fois : garder l'ancien casserait la session.
  const { fetcher, calls } = fakeFetch(json(200, { ...TOKEN_BODY, access_token: 'AT1', refresh_token: 'RT1' }));
  const next = await refreshTokens(OLD, { fetcher, now: () => 5000 });
  assert.equal(calls[0].url, 'https://id.twitch.tv/oauth2/token');
  assert.equal(calls[0].body.get('grant_type'), 'refresh_token');
  assert.equal(calls[0].body.get('refresh_token'), 'RT0');
  assert.equal(calls[0].body.get('client_id'), CLIENT_ID);
  assert.equal(calls[0].body.has('client_secret'), false);
  assert.deepEqual(next, { accessToken: 'AT1', refreshToken: 'RT1', expiresAt: 5000 + 14000 * 1000, userId: '1337', login: 'lelio' });
});

test('un renouvellement refuse demande de se reconnecter', async () => {
  const { fetcher } = fakeFetch(json(400, { status: 400, message: 'Invalid refresh token' }));
  await assert.rejects(
    refreshTokens(OLD, { fetcher, now: () => 0 }),
    (e) => e instanceof TwitchAuthError && e.code === 'reconnect-needed',
  );
});

test('une panne reseau pendant le renouvellement ne force PAS a se reconnecter', async () => {
  // Le jeton de renouvellement n'est pas consomme : on pourra reessayer.
  const fetcher = async () => { throw new TypeError('fetch failed'); };
  await assert.rejects(
    refreshTokens(OLD, { fetcher, now: () => 0 }),
    (e) => e instanceof TwitchAuthError && e.code === 'network',
  );
});

test('aucune erreur ne contient un jeton', async () => {
  const { fetcher } = fakeFetch(json(400, { status: 400, message: 'Invalid refresh token RT0' }));
  await assert.rejects(refreshTokens(OLD, { fetcher, now: () => 0 }), (e) => !String(e.message).includes('RT0'));
});

test('se deconnecter revoque l autorisation chez Twitch', async () => {
  const { fetcher, calls } = fakeFetch(new Response(null, { status: 200 }));
  await revokeToken('AT0', fetcher);
  assert.equal(calls[0].url, 'https://id.twitch.tv/oauth2/revoke');
  assert.equal(calls[0].body.get('client_id'), CLIENT_ID);
  assert.equal(calls[0].body.get('token'), 'AT0');
});

test('une revocation refusee est rapportee sans citer le jeton', async () => {
  const { fetcher } = fakeFetch(json(400, { status: 400, message: 'Invalid token AT0' }));
  await assert.rejects(revokeToken('AT0', fetcher), (e) => e instanceof TwitchAuthError && !String(e.message).includes('AT0'));
});

test('seuls un jeton invalide (400, 401) force a se reconnecter ; le reste est passager', async () => {
  for (const [status, code] of [[400, 'reconnect-needed'], [401, 'reconnect-needed'], [429, 'network'], [408, 'network'], [503, 'network']]) {
    const { fetcher } = fakeFetch(json(status, { message: 'x' }));
    await assert.rejects(refreshTokens(OLD, { fetcher, now: () => 0 }), (e) => e instanceof TwitchAuthError && e.code === code, String(status));
  }
});

test('un intervalle nul ou negatif annonce par Twitch ne fait pas boucler sans pause', async () => {
  const waits = [];
  for (const interval of [0, -3]) {
    waits.length = 0;
    const { fetcher } = fakeFetch(json(200, TOKEN_BODY), json(200, VALIDATE_BODY));
    await pollDeviceFlow({ ...DEVICE, intervalSeconds: interval }, { fetcher, sleep: async (ms) => { waits.push(ms); }, now: () => 0 });
    assert.ok(waits[0] >= 1000, 'intervalle ' + interval + ' : attente de ' + waits[0] + ' ms');
  }
});

test('quelques pannes reseau pendant l attente n annulent pas l appairage', async () => {
  const outcomes = [new TypeError('fetch failed'), json(503, {}), json(400, { message: 'authorization_pending' }), json(200, TOKEN_BODY), json(200, VALIDATE_BODY)];
  const fetcher = async () => { const next = outcomes.shift(); if (next instanceof Error) throw next; return next; };
  const tokens = await pollDeviceFlow(DEVICE, { fetcher, sleep: async () => {}, now: () => 0 });
  assert.equal(tokens.accessToken, 'AT');
});

test('des pannes reseau qui durent finissent par arreter l appairage', async () => {
  const fetcher = async () => { throw new TypeError('fetch failed'); };
  await assert.rejects(
    pollDeviceFlow(DEVICE, { fetcher, sleep: async () => {}, now: () => 0 }),
    (e) => e instanceof TwitchAuthError && e.code === 'network',
  );
});
