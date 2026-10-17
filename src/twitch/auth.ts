/**
 * Connexion au compte Twitch du streamer, par « Device Code Grant ».
 *
 * Ce que fait ce module : obtenir et renouveler les jetons qui autorisent le
 * plugin a lire et a gerer les rachats de points de chaine.
 *
 * Choix non evidents :
 *
 *   - Application PUBLIQUE, donc aucun secret a embarquer. Le Client ID ci-dessous
 *     n'est pas confidentiel : il identifie l'application, il n'ouvre rien. Le
 *     streamer autorise sur twitch.tv avec un code court, sans que le plugin ait
 *     besoin d'un serveur ni d'une adresse de retour.
 *
 *   - Les DEUX permissions sont verifiees sur le jeton rendu (`/validate`), pas
 *     supposees : le streamer peut decocher une permission sur l'ecran d'accord.
 *     Un jeton incomplet ferait echouer les remboursements bien plus tard, au
 *     pire moment — quand un viewer a deja paye.
 *
 *   - Un jeton de renouvellement n'est valable qu'UNE fois. `refreshTokens`
 *     rend donc les deux jetons, et l'appelant doit ecrire le resultat avant
 *     toute autre chose. Une panne reseau (`network`) n'a pas consomme le jeton ;
 *     un refus de Twitch (`reconnect-needed`) l'a rendu inutilisable, et il faut
 *     alors repasser par le code.
 *
 *   - Les erreurs portent un code et un message FIXES, jamais le texte de la
 *     reponse de Twitch : ce texte peut contenir un jeton.
 *
 * Invariant : ce module ne lit ni n'ecrit aucun reglage et n'importe pas le SDK.
 * Le reseau, l'horloge et l'attente sont injectes, donc tout se teste sans
 * compte Twitch.
 *
 * Usage canonique :
 *   const code = await startDeviceFlow(fetch);          // afficher code.userCode
 *   const tokens = await pollDeviceFlow(code, { fetcher: fetch, sleep, now: Date.now });
 */
import { isTwitchHttpsUrl } from './protocol.ts';

/** Identifiant de l'application LumenDeck enregistree chez Twitch (type Public). Pas un secret. */
export const CLIENT_ID = 'zhwoehaylaswgmt8ywojf63tvd4nn2';

/** Lire les rachats, et les valider ou rembourser. Rien d'autre : pas de chat, pas d'e-mail. */
export const SCOPES = ['channel:read:redemptions', 'channel:manage:redemptions'] as const;

const DEVICE_URL = 'https://id.twitch.tv/oauth2/device';
const TOKEN_URL = 'https://id.twitch.tv/oauth2/token';
const VALIDATE_URL = 'https://id.twitch.tv/oauth2/validate';
const REVOKE_URL = 'https://id.twitch.tv/oauth2/revoke';
const DEVICE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code';

/** Rallonge demandee par Twitch quand on interroge trop vite. */
const SLOW_DOWN_MS = 5000;

/** Attente minimale entre deux interrogations, quoi qu'annonce Twitch : un 0 ferait boucler sans pause. */
const MIN_POLL_MS = 1000;

/**
 * Pannes reseau consecutives tolerees pendant l'attente de l'autorisation.
 *
 * L'attente dure jusqu'a 30 minutes : une coupure d'une seconde ne doit pas la
 * faire echouer, et le streamer repartir de zero. Au-dela, la panne est reelle.
 */
const MAX_TRANSIENT_FAILURES = 3;

/** Ce que le streamer doit faire : ouvrir l'adresse et verifier le code. */
export type DeviceCode = {
  readonly deviceCode: string;
  readonly userCode: string;
  readonly verificationUri: string;
  readonly expiresInSeconds: number;
  readonly intervalSeconds: number;
};

/** La session Twitch du streamer. SECRET : jamais journalisee, jamais renvoyee au panneau. */
export type Tokens = {
  readonly accessToken: string;
  readonly refreshToken: string;
  /** Instant d'expiration du jeton d'acces, en millisecondes. */
  readonly expiresAt: number;
  readonly userId: string;
  readonly login: string;
};

export type AuthErrorCode =
  | 'network'
  | 'rejected'
  | 'expired'
  | 'cancelled'
  | 'missing-scope'
  | 'invalid-response'
  | 'reconnect-needed';

const MESSAGES: Readonly<Record<AuthErrorCode, string>> = {
  network: 'Twitch est injoignable',
  rejected: 'Twitch a refuse la demande',
  expired: 'le code a expire',
  cancelled: 'connexion annulee',
  'missing-scope': 'une permission demandee a ete refusee',
  'invalid-response': 'reponse de Twitch inattendue',
  'reconnect-needed': 'la session Twitch a expire : se reconnecter',
};

export class TwitchAuthError extends Error {
  readonly code: AuthErrorCode;

  constructor(code: AuthErrorCode) {
    super(MESSAGES[code]);
    this.name = 'TwitchAuthError';
    this.code = code;
  }
}

export type Fetcher = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<Response>;

type Dict = Record<string, unknown>;
const isDict = (value: unknown): value is Dict => typeof value === 'object' && value !== null && !Array.isArray(value);

async function send(fetcher: Fetcher, url: string, init?: Parameters<Fetcher>[1]): Promise<Response> {
  try {
    return await fetcher(url, init);
  } catch {
    throw new TwitchAuthError('network');
  }
}

async function body(response: Response): Promise<Dict> {
  try {
    const value: unknown = await response.json();
    return isDict(value) ? value : {};
  } catch {
    return {};
  }
}

const form = (fields: Record<string, string>) => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams(fields).toString(),
});

/** Demande a Twitch un code a faire saisir au streamer. */
export async function startDeviceFlow(fetcher: Fetcher): Promise<DeviceCode> {
  const response = await send(fetcher, DEVICE_URL, form({ client_id: CLIENT_ID, scopes: SCOPES.join(' ') }));
  if (!response.ok) throw new TwitchAuthError(response.status >= 500 ? 'network' : 'rejected');

  const data = await body(response);
  const { device_code: deviceCode, user_code: userCode, verification_uri: uri, expires_in: expires, interval } = data;
  if (typeof deviceCode !== 'string' || typeof userCode !== 'string' || typeof uri !== 'string'
    || typeof expires !== 'number' || typeof interval !== 'number') {
    throw new TwitchAuthError('invalid-response');
  }
  // Le panneau affiche et ouvre cette adresse : elle ne doit mener que chez Twitch.
  if (!isTwitchHttpsUrl(uri)) throw new TwitchAuthError('invalid-response');

  return { deviceCode, userCode, verificationUri: uri, expiresInSeconds: expires, intervalSeconds: interval };
}

/** Lit une reponse de jeton ; `userId` et `login` viennent de `/validate`. */
function readTokens(data: Dict, now: number): { accessToken: string; refreshToken: string; expiresAt: number } {
  const { access_token: access, refresh_token: refresh, expires_in: expires } = data;
  if (typeof access !== 'string' || typeof refresh !== 'string' || typeof expires !== 'number') {
    throw new TwitchAuthError('invalid-response');
  }
  return { accessToken: access, refreshToken: refresh, expiresAt: now + expires * 1000 };
}

/** Interroge Twitch sur le jeton : a qui, pour quelle application, avec quelles permissions. */
async function validate(accessToken: string, fetcher: Fetcher): Promise<{ userId: string; login: string }> {
  const response = await send(fetcher, VALIDATE_URL, { headers: { Authorization: 'OAuth ' + accessToken } });
  if (!response.ok) throw new TwitchAuthError('invalid-response');

  const data = await body(response);
  if (data.client_id !== CLIENT_ID || typeof data.user_id !== 'string' || typeof data.login !== 'string') {
    throw new TwitchAuthError('invalid-response');
  }
  const granted = Array.isArray(data.scopes) ? data.scopes : [];
  if (!SCOPES.every((scope) => granted.includes(scope))) throw new TwitchAuthError('missing-scope');
  return { userId: data.user_id, login: data.login };
}

export type PollOptions = {
  readonly fetcher: Fetcher;
  readonly sleep: (ms: number) => Promise<void>;
  readonly now: () => number;
  /** Le panneau ferme ou l'utilisateur annule : l'attente doit s'arreter. */
  readonly signal?: AbortSignal;
};

/**
 * Attend que le streamer ait saisi le code, puis rend sa session.
 *
 * Respecte l'intervalle annonce par Twitch, s'allonge quand il le demande, et
 * s'arrete quand le code expire ou quand le panneau annule.
 */
export async function pollDeviceFlow(device: DeviceCode, options: PollOptions): Promise<Tokens> {
  const { fetcher, sleep, now, signal } = options;
  const deadline = now() + device.expiresInSeconds * 1000;
  let waitMs = Math.max(MIN_POLL_MS, device.intervalSeconds * 1000);
  let transient = 0;

  for (;;) {
    await sleep(waitMs);
    if (signal?.aborted) throw new TwitchAuthError('cancelled');
    if (now() >= deadline) throw new TwitchAuthError('expired');

    let response: Response;
    try {
      response = await send(fetcher, TOKEN_URL, form({
        client_id: CLIENT_ID,
        scopes: SCOPES.join(' '),
        device_code: device.deviceCode,
        grant_type: DEVICE_GRANT,
      }));
    } catch (error: unknown) {
      if (error instanceof TwitchAuthError && error.code === 'network' && ++transient <= MAX_TRANSIENT_FAILURES) continue;
      throw error;
    }

    if (response.status >= 500) {
      if (++transient <= MAX_TRANSIENT_FAILURES) continue;
      throw new TwitchAuthError('network');
    }
    transient = 0;

    if (response.ok) {
      const tokens = readTokens(await body(response), now());
      return { ...tokens, ...(await validate(tokens.accessToken, fetcher)) };
    }

    const message = (await body(response)).message;
    if (message === 'authorization_pending') continue;
    if (message === 'slow_down') { waitMs += SLOW_DOWN_MS; continue; }
    if (message === 'expired_token' || message === 'invalid device code') throw new TwitchAuthError('expired');
    throw new TwitchAuthError('rejected');
  }
}

/** Renouvelle la session. L'ancien jeton de renouvellement est consomme : ecrire le resultat AVANT tout. */
export async function refreshTokens(
  current: Tokens,
  options: { readonly fetcher: Fetcher; readonly now: () => number },
): Promise<Tokens> {
  const response = await send(options.fetcher, TOKEN_URL, form({
    grant_type: 'refresh_token',
    refresh_token: current.refreshToken,
    client_id: CLIENT_ID,
  }));
  if (!response.ok) {
    // Seul un jeton INVALIDE (400, 401) rend la session inutilisable. Un 429, un
    // 408 ou un 5xx est passager : traiter le reste comme un refus effacerait la
    // session du streamer en plein direct pour un simple incident de Twitch.
    throw new TwitchAuthError(response.status === 400 || response.status === 401 ? 'reconnect-needed' : 'network');
  }

  const tokens = readTokens(await body(response), options.now());
  return { ...tokens, userId: current.userId, login: current.login };
}

/**
 * Retire l'autorisation accordee au plugin, chez Twitch.
 *
 * Se deconnecter en oubliant simplement les jetons laisserait l'autorisation
 * valable : le jeton, s'il avait fuite, resterait utilisable jusqu'a son
 * expiration. Le streamer doit pouvoir couper l'acces pour de bon.
 */
export async function revokeToken(accessToken: string, fetcher: Fetcher): Promise<void> {
  const response = await send(fetcher, REVOKE_URL, form({ client_id: CLIENT_ID, token: accessToken }));
  if (!response.ok) throw new TwitchAuthError(response.status >= 500 ? 'network' : 'rejected');
}
