/**
 * Lecture des messages EventSub (WebSocket) de Twitch.
 *
 * Ce que fait ce module : transformer le texte brut recu sur la socket en un
 * message type que le client sait traiter, sans jamais lever d'exception.
 *
 * Choix non evidents :
 *
 *   - Le client ne se fie pas au contenu : chaque champ est verifie avant
 *     d'etre lu. Le texte du viewer (`user_input`) vient d'un inconnu, et
 *     le reste transite par un tiers de confiance mais reste du JSON recu.
 *
 *   - Seul un rachat `unfulfilled` est rendu. Twitch peut renvoyer un rachat
 *     deja valide ou rembourse (apres une reconnexion, par exemple) : le
 *     rejouer ferait allumer deux fois la meme couleur.
 *
 *   - L'adresse de reconnexion est CONTROLEE : `wss:` et un hote de la famille
 *     `*.twitch.tv`, sans identifiants. Elle est fournie par Twitch, mais la
 *     suivre aveuglement ferait ouvrir une connexion, jeton compris, vers un
 *     serveur quelconque si ce message etait un jour falsifie.
 *
 *   - Un type de message inconnu est IGNORE, pas invalide : Twitch ajoute des
 *     types, et un plugin qui plante sur une nouveaute est un plugin cassable
 *     par une mise a jour de leur cote.
 *
 * Invariant : `parseMessage` ne leve jamais et n'a aucun effet de bord. Pure,
 * elle se teste sans reseau, sans Stream Deck et sans compte Twitch.
 *
 * Usage canonique :
 *   socket.onmessage = (e) => handle(parseMessage(String(e.data)));
 */

/** Ce qu'un viewer a depense ses points pour obtenir. */
export type Redemption = {
  readonly id: string;
  readonly rewardId: string;
  readonly rewardTitle: string;
  /** Prix paye, en points. Sert a la duree d'un scenario ; 0 s'il est illisible (duree minimale). */
  readonly rewardCost: number;
  readonly userName: string;
  /** Texte saisi par le viewer. Vide s'il n'y en avait pas. NON FIABLE : voir viewer-color.ts. */
  readonly userInput: string;
};

export type Message =
  | { readonly kind: 'welcome'; readonly sessionId: string; readonly keepaliveSeconds: number }
  | { readonly kind: 'keepalive' }
  | { readonly kind: 'redemption'; readonly redemption: Redemption }
  | { readonly kind: 'reconnect'; readonly url: string }
  | { readonly kind: 'revoked'; readonly reason: string }
  /** Message bien forme qui ne nous concerne pas. */
  | { readonly kind: 'ignored' }
  /** Message illisible ou incomplet. */
  | { readonly kind: 'invalid' };

const REDEMPTION_TYPE = 'channel.channel_points_custom_reward_redemption.add';

const INVALID: Message = { kind: 'invalid' };
const IGNORED: Message = { kind: 'ignored' };

type Dict = Record<string, unknown>;

const isDict = (value: unknown): value is Dict =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined;

/** Vrai pour une adresse du protocole voulu, chez `twitch.tv` ou l'un de ses sous-domaines, sans identifiants. */
function isTwitchUrl(candidate: string, protocol: 'wss:' | 'https:'): boolean {
  try {
    const url = new URL(candidate);
    return url.protocol === protocol
      && url.username === '' && url.password === ''
      && (url.hostname === 'twitch.tv' || url.hostname.endsWith('.twitch.tv'));
  } catch {
    return false;
  }
}

/** Vrai pour `wss://<...>.twitch.tv/...` : la seule socket a laquelle on se reconnecte. */
export const isTwitchSocketUrl = (candidate: string): boolean => isTwitchUrl(candidate, 'wss:');

/** Vrai pour `https://<...>.twitch.tv/...` : la seule page qu'on affiche ou ouvre pour le streamer. */
export const isTwitchHttpsUrl = (candidate: string): boolean => isTwitchUrl(candidate, 'https:');

function readRedemption(event: unknown): Message {
  if (!isDict(event) || !isDict(event.reward)) return INVALID;

  const id = text(event.id);
  const rewardId = text(event.reward.id);
  const userName = text(event.user_name);
  if (!id || !rewardId || !userName) return INVALID;

  // Un texte absent est un texte vide ; un texte d'un autre type est un message abime.
  const input = event.user_input;
  if (input !== undefined && typeof input !== 'string') return INVALID;

  if (event.status !== 'unfulfilled') return IGNORED;

  return {
    kind: 'redemption',
    redemption: {
      id,
      rewardId,
      rewardTitle: typeof event.reward.title === 'string' ? event.reward.title : '',
      rewardCost: typeof event.reward.cost === 'number' && Number.isFinite(event.reward.cost) ? event.reward.cost : 0,
      userName,
      userInput: input ?? '',
    },
  };
}

/** Lit un message de la socket. Ne leve jamais. */
export function parseMessage(raw: string): Message {
  let message: unknown;
  try {
    message = JSON.parse(raw);
  } catch {
    return INVALID;
  }
  if (!isDict(message) || !isDict(message.metadata)) return INVALID;

  const type = message.metadata.message_type;
  if (typeof type !== 'string') return INVALID;
  const payload = isDict(message.payload) ? message.payload : {};

  switch (type) {
    case 'session_welcome': {
      const session = payload.session;
      if (!isDict(session)) return INVALID;
      const sessionId = text(session.id);
      const keepalive = session.keepalive_timeout_seconds;
      if (!sessionId || typeof keepalive !== 'number') return INVALID;
      return { kind: 'welcome', sessionId, keepaliveSeconds: keepalive };
    }
    case 'session_keepalive':
      return { kind: 'keepalive' };
    case 'session_reconnect': {
      const url = isDict(payload.session) ? text(payload.session.reconnect_url) : undefined;
      return url && isTwitchSocketUrl(url) ? { kind: 'reconnect', url } : INVALID;
    }
    case 'revocation': {
      const reason = isDict(payload.subscription) ? text(payload.subscription.status) : undefined;
      return { kind: 'revoked', reason: reason ?? 'unknown' };
    }
    case 'notification':
      return message.metadata.subscription_type === REDEMPTION_TYPE
        ? readRedemption(payload.event)
        : IGNORED;
    default:
      return IGNORED;
  }
}
