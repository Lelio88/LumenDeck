/**
 * Client minimal de l'API Twitch (Helix) pour les points de chaine.
 *
 * Ce que fait ce module : creer, lister et supprimer les recompenses du plugin,
 * et valider ou rembourser un rachat.
 *
 * Choix non evidents :
 *
 *   - Le plugin CREE ses recompenses lui-meme. Twitch ne laisse modifier le
 *     statut d'un rachat qu'a l'application qui a cree la recompense : une
 *     recompense faite a la main dans le tableau de bord ne pourrait jamais etre
 *     remboursee. C'est aussi pourquoi `listOwnRewards` ne demande que les
 *     recompenses « gerables » — les autres ne nous concernent pas et on ne
 *     doit pas y toucher.
 *
 *   - La saisie du viewer est OBLIGATOIRE par defaut (`is_user_input_required`) :
 *     une recompense « choisis la couleur » sans zone de texte ferait payer des
 *     points pour rien. Les boutons (une couleur, un scenario) la desactivent
 *     explicitement (`userInput: false`).
 *
 *   - L'abonnement aux rachats peut couvrir toute la chaine (voir
 *     `subscribeToRedemptions`) : le tri des rachats qui ne sont pas au plugin
 *     se fait chez l'appelant, sans lire leur texte.
 *
 *   - Le cooldown et le quota par viewer sont ceux de Twitch, pas les notres :
 *     ils sont appliques cote Twitch AVANT le rachat, donc le viewer n'est
 *     jamais debite pour un essai qui serait refuse.
 *
 *   - Les erreurs sont CLASSEES (`HelixError.code`) et leur message est fixe,
 *     jamais le texte de la reponse : ce texte peut citer un jeton.
 *
 * Invariant : aucun reglage lu ni ecrit, pas de SDK, reseau injecte. Le
 * renouvellement du jeton sur `unauthorized` est a la charge de l'appelant, qui
 * possede la session.
 *
 * Usage canonique :
 *   const mine = await listOwnRewards({ accessToken, userId }, fetch);
 *   await settleRedemption(session, { redemptionId, rewardId }, 'refund', fetch);
 */
import { CLIENT_ID, type Fetcher } from './auth.ts';

const API = 'https://api.twitch.tv/helix';

/** Ce qu'il faut pour parler a Twitch au nom du streamer. */
export type HelixSession = {
  readonly accessToken: string;
  /** Identifiant de la chaine : celui du streamer connecte. */
  readonly userId: string;
};

/** Ce que le plugin veut voir exister cote Twitch. */
export type RewardDefinition = {
  readonly title: string;
  readonly cost: number;
  readonly prompt: string;
  /** Delai entre deux rachats, toutes personnes confondues. Absent : aucun. */
  readonly cooldownSeconds?: number;
  /** Rachats maximum par viewer et par direct. Absent : illimite. */
  readonly perUserPerStream?: number;
  /** Le viewer doit ecrire un texte. Absent : oui (« Choisis la couleur »). Un bouton de couleur fixe : non. */
  readonly userInput?: boolean;
};

/** Une recompense telle que Twitch la connait. */
export type Reward = {
  readonly id: string;
  readonly title: string;
  readonly cost: number;
  readonly prompt: string;
  readonly isEnabled: boolean;
};

export type HelixErrorCode =
  | 'network'
  | 'unauthorized'
  | 'forbidden'
  | 'not-found'
  | 'rate-limited'
  | 'duplicate'
  | 'rejected'
  | 'invalid-response';

const MESSAGES: Readonly<Record<HelixErrorCode, string>> = {
  network: 'Twitch est injoignable',
  unauthorized: 'la session Twitch a expire',
  forbidden: 'Twitch refuse cette action pour cette chaine ou cette recompense',
  'not-found': 'recompense ou rachat introuvable chez Twitch',
  'rate-limited': 'trop de requetes vers Twitch',
  duplicate: 'une recompense de ce nom existe deja',
  rejected: 'Twitch a refuse la requete',
  'invalid-response': 'reponse de Twitch inattendue',
};

export class HelixError extends Error {
  readonly code: HelixErrorCode;

  constructor(code: HelixErrorCode) {
    super(MESSAGES[code]);
    this.name = 'HelixError';
    this.code = code;
  }
}

type Dict = Record<string, unknown>;
const isDict = (value: unknown): value is Dict => typeof value === 'object' && value !== null && !Array.isArray(value);

async function call(
  session: HelixSession,
  fetcher: Fetcher,
  path: string,
  query: Record<string, string>,
  init: { method?: string; body?: Dict; unscoped?: boolean } = {},
): Promise<Dict> {
  const url = new URL(API + path);
  // Les routes des recompenses portent la chaine en parametre ; EventSub la porte dans son corps.
  const scope = init.unscoped ? {} : { broadcaster_id: session.userId };
  for (const [key, value] of Object.entries({ ...scope, ...query })) url.searchParams.set(key, value);

  let response: Response;
  try {
    response = await fetcher(url.toString(), {
      method: init.method ?? 'GET',
      headers: {
        Authorization: 'Bearer ' + session.accessToken,
        'Client-Id': CLIENT_ID,
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(init.body ? { body: JSON.stringify(init.body) } : {}),
    });
  } catch {
    throw new HelixError('network');
  }

  if (response.ok) {
    try {
      const value: unknown = await response.json();
      return isDict(value) ? value : {};
    } catch {
      return {};
    }
  }

  const detail = await response.json().then((v: unknown) => (isDict(v) ? v.message : undefined), () => undefined);
  switch (response.status) {
    case 401: throw new HelixError('unauthorized');
    case 403: throw new HelixError('forbidden');
    case 404: throw new HelixError('not-found');
    case 429: throw new HelixError('rate-limited');
    case 400: throw new HelixError(detail === 'CREATE_CUSTOM_REWARD_DUPLICATE_REWARD' ? 'duplicate' : 'rejected');
    default: throw new HelixError(response.status >= 500 ? 'network' : 'rejected');
  }
}

function readRewards(data: Dict): Reward[] {
  if (!Array.isArray(data.data)) throw new HelixError('invalid-response');
  return data.data.map((item: unknown): Reward => {
    if (!isDict(item) || typeof item.id !== 'string' || typeof item.title !== 'string' || typeof item.cost !== 'number') {
      throw new HelixError('invalid-response');
    }
    return {
      id: item.id,
      title: item.title,
      cost: item.cost,
      prompt: typeof item.prompt === 'string' ? item.prompt : '',
      isEnabled: item.is_enabled === true,
    };
  });
}

/** Les recompenses que ce plugin a creees (les autres ne sont pas gerables par lui). */
export async function listOwnRewards(session: HelixSession, fetcher: Fetcher): Promise<Reward[]> {
  return readRewards(await call(session, fetcher, '/channel_points/custom_rewards', { only_manageable_rewards: 'true' }));
}

/** Cree une recompense ; la saisie est obligatoire sauf si `userInput` vaut faux. */
export async function createReward(session: HelixSession, definition: RewardDefinition, fetcher: Fetcher): Promise<Reward> {
  const cooldown = definition.cooldownSeconds;
  const quota = definition.perUserPerStream;
  const [created] = readRewards(await call(session, fetcher, '/channel_points/custom_rewards', {}, {
    method: 'POST',
    body: {
      title: definition.title,
      cost: definition.cost,
      prompt: definition.prompt,
      is_user_input_required: definition.userInput !== false,
      is_global_cooldown_enabled: cooldown !== undefined,
      ...(cooldown !== undefined ? { global_cooldown_seconds: cooldown } : {}),
      is_max_per_user_per_stream_enabled: quota !== undefined,
      ...(quota !== undefined ? { max_per_user_per_stream: quota } : {}),
      should_redemptions_skip_request_queue: false,
    },
  }));
  if (!created) throw new HelixError('invalid-response');
  return created;
}

/** Supprime une recompense du plugin. */
export async function deleteReward(session: HelixSession, rewardId: string, fetcher: Fetcher): Promise<void> {
  await call(session, fetcher, '/channel_points/custom_rewards', { id: rewardId }, { method: 'DELETE' });
}

/**
 * Abonne la socket EventSub aux rachats d'une recompense, ou de toute la chaine.
 *
 * Avec `rewardId`, on ne recoit que cette recompense. Sans, on recoit tous les
 * rachats de la chaine : c'est ce que fait le plugin des qu'il gere PLUSIEURS
 * recompenses (palette, scenarios), un abonnement par recompense obligeant a
 * suivre chaque ajout ou retrait du panneau. Les rachats qui ne sont pas les
 * siens sont ignores sans etre lus ni journalises (voir handler.ts).
 */
export async function subscribeToRedemptions(
  session: HelixSession,
  target: { readonly sessionId: string; readonly rewardId?: string },
  fetcher: Fetcher,
): Promise<void> {
  await call(session, fetcher, '/eventsub/subscriptions', {}, {
    method: 'POST',
    unscoped: true,
    body: {
      type: 'channel.channel_points_custom_reward_redemption.add',
      version: '1',
      condition: { broadcaster_user_id: session.userId, ...(target.rewardId ? { reward_id: target.rewardId } : {}) },
      transport: { method: 'websocket', session_id: target.sessionId },
    },
  });
}

/**
 * Cloture un rachat : `refund` rend les points au viewer, `fulfil` les garde.
 *
 * Twitch n'accepte la mise a jour que sur un rachat encore en attente
 * (`unfulfilled`) : cloturer deux fois le meme rachat est une erreur, d'ou
 * l'importance de n'en traiter qu'une fois.
 */
export async function settleRedemption(
  session: HelixSession,
  redemption: { readonly redemptionId: string; readonly rewardId: string },
  outcome: 'refund' | 'fulfil',
  fetcher: Fetcher,
): Promise<void> {
  await call(
    session,
    fetcher,
    '/channel_points/custom_rewards/redemptions',
    { id: redemption.redemptionId, reward_id: redemption.rewardId },
    { method: 'PATCH', body: { status: outcome === 'refund' ? 'CANCELED' : 'FULFILLED' } },
  );
}

/** Un rachat reste en attente chez Twitch : paye, ni valide ni rembourse. */
export type PendingRedemption = {
  readonly id: string;
  readonly rewardId: string;
  /** Instant du rachat, en millisecondes. */
  readonly redeemedAt: number;
};

/**
 * Les rachats d'UNE recompense qui n'ont jamais ete clos.
 *
 * Twitch garde un rachat en file tant que personne ne l'a valide ou rembourse :
 * pendant que le plugin est ferme ou coupe, ses viewers paient dans le vide, et
 * EventSub ne rejoue rien. Ce balayage est le seul moyen de les retrouver.
 *
 * Un rachat dont la date est illisible est ECARTE : le supposer ancien le ferait
 * rembourser alors qu'il est peut-etre en cours de traitement.
 */
export async function listPendingRedemptions(session: HelixSession, rewardId: string, fetcher: Fetcher): Promise<PendingRedemption[]> {
  const data = await call(session, fetcher, '/channel_points/custom_rewards/redemptions', {
    reward_id: rewardId,
    status: 'UNFULFILLED',
    first: '50',
  });
  if (!Array.isArray(data.data)) throw new HelixError('invalid-response');

  const pending: PendingRedemption[] = [];
  for (const item of data.data as unknown[]) {
    if (!isDict(item) || typeof item.id !== 'string' || typeof item.redeemed_at !== 'string') continue;
    const redeemedAt = Date.parse(item.redeemed_at);
    if (Number.isNaN(redeemedAt)) continue;
    pending.push({ id: item.id, rewardId, redeemedAt });
  }
  return pending;
}

/** Tentatives de cloture : une panne de quelques secondes ne doit pas laisser un viewer debite. */
const SETTLE_ATTEMPTS = 3;
const SETTLE_RETRY_MS = 1000;

/**
 * Comme `settleRedemption`, avec quelques reprises sur panne PASSAGERE.
 *
 * Seuls `network` et `rate-limited` sont rejoues. Un refus d'authentification
 * n'est PAS rejoue ici : le renouvellement du jeton appartient a l'appelant, qui
 * possede la session. Un refus definitif (403, 404, 400) ne changera pas en
 * insistant. Le delai double a chaque reprise ; l'attente est injectee.
 */
export async function settleWithRetry(
  session: HelixSession,
  redemption: { readonly redemptionId: string; readonly rewardId: string },
  outcome: 'refund' | 'fulfil',
  fetcher: Fetcher,
  wait: (ms: number) => Promise<void>,
): Promise<void> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await settleRedemption(session, redemption, outcome, fetcher);
    } catch (error: unknown) {
      const transient = error instanceof HelixError && (error.code === 'network' || error.code === 'rate-limited');
      if (!transient || attempt >= SETTLE_ATTEMPTS) throw error;
      await wait(SETTLE_RETRY_MS * 2 ** (attempt - 1));
    }
  }
}

/**
 * Met une recompense en pause chez Twitch, ou la reactive.
 *
 * En pause, la recompense reste visible mais ne peut plus etre achetee : c'est
 * mieux que d'encaisser puis rembourser, le viewer ne depense rien. Le plugin
 * s'en sert pour sa touche Pause et a sa fermeture (voir service.ts).
 */
export async function setRewardPaused(session: HelixSession, rewardId: string, paused: boolean, fetcher: Fetcher): Promise<void> {
  await call(session, fetcher, '/channel_points/custom_rewards', { id: rewardId }, { method: 'PATCH', body: { is_paused: paused } });
}
