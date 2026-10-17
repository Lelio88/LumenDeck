/**
 * Service Twitch du plugin : relie la session du streamer, la recompense, la
 * socket de rachats et les ampoules.
 *
 * Ce que fait ce module : quand un viewer depense ses points, appliquer sa
 * couleur aux ampoules choisies puis valider le rachat — ou le rembourser.
 *
 * Il ne contient AUCUNE regle metier : la lecture de la couleur est dans
 * viewer-color.ts, la decision dans handler.ts, le protocole dans protocol.ts et
 * eventsub.ts, les appels reseau dans auth.ts et helix.ts, les decisions d'etat
 * dans state.ts et face.ts. Tout cela se teste sans Stream Deck. Ce fichier est
 * la colle, et la seule partie qui touche au SDK, aux reglages globaux et aux
 * ampoules.
 *
 * Choix non evidents :
 *
 *   - Le service tourne des le demarrage du plugin des qu'une session existe,
 *     qu'une touche Twitch soit affichee ou non. Une touche sur une page non
 *     visible ne recoit aucun evenement : en dependre laisserait des viewers
 *     payer pour rien. Les ampoules visees et l'etat de pause sont donc
 *     PERSISTES, et relus au demarrage.
 *
 *   - AUCUNE ecriture n'a lieu avant la fin de `init`. Une touche affichee des le
 *     lancement appelle `setBulbs` pendant que `init` lit encore le disque ; sans
 *     cette attente, un etat vide serait ecrit par-dessus la session persistee.
 *     Toute modification se calcule de plus a partir de la valeur DU DISQUE
 *     (voir global-store.ts), jamais d'un instantane en memoire.
 *
 *   - Une « epoque » numerote chaque mise en ligne. `goOnline` attend le reseau
 *     (plusieurs appels de 15 s) : pendant ce temps, une deconnexion, une session
 *     perdue ou une seconde mise en ligne ont pu avoir lieu. Apres chaque
 *     attente, une epoque perimee abandonne — sans quoi une socket orpheline
 *     resterait ouverte et occuperait une des places que Twitch limite.
 *
 *   - Le jeton de renouvellement est a usage unique : tout renouvellement est
 *     serialise (un seul en vol) et ECRIT avant d'etre utilise. Deux
 *     renouvellements simultanes en consommeraient chacun un, et le second
 *     echouerait en invalidant la session entiere.
 *
 *   - Un rachat paye pendant une coupure reste « en attente » chez Twitch :
 *     EventSub ne rejoue rien. A chaque abonnement, on rembourse donc ceux que
 *     le plugin n'a pas vus et qui ont plus d'une minute (plus recents, ils sont
 *     peut-etre en cours de traitement). La recompense reste active pendant que
 *     le plugin est ferme : ces rachats-la sont rembourses au prochain demarrage.
 *
 *   - Un scenario en cours sur une ampoule visee est ARRETE avant d'appliquer la
 *     couleur : sinon sa prochaine image effacerait le choix du viewer
 *     quelques centaines de millisecondes plus tard.
 *
 *   - La session et la liste des ampoules vivent dans les reglages globaux,
 *     donc au meme niveau de confiance que les cles locales : jamais
 *     journalises, jamais renvoyes au panneau.
 *
 * Invariant : le panneau et la touche ne recoivent que `Status`, jamais un jeton.
 *
 * Usage canonique :
 *   await init();                       // plugin.ts, au demarrage
 *   onStatus((status) => repaint(status));
 *   void beginPairing();                // depuis le panneau
 */
import streamDeck from '@elgato/streamdeck';

import { fanOut } from '../actions/group.js';
import { coordinatesForMany } from '../bulbs.js';
import { withRetry } from '../driver/pool.js';
import type { Hsv } from '../driver/types.js';
import { readGlobal, updateGlobal } from '../globals.js';
import { t } from '../i18n.js';
import { stop as stopScenario } from '../scenarios/runner.js';
import {
  TwitchAuthError, pollDeviceFlow, refreshTokens, revokeToken, startDeviceFlow,
  type Fetcher, type Tokens,
} from './auth.js';
import { createEventSubClient, type ClientState, type EventSubClient, type SocketLike, type SubscribeResult } from './eventsub.js';
import type { Link } from './face.js';
import { createRedemptionHandler, staleRedemptions, type Outcome } from './handler.js';
import {
  HelixError, createReward, deleteReward, listOwnRewards, listPendingRedemptions, settleWithRetry, subscribeToRedemptions,
  type HelixSession, type RewardDefinition,
} from './helix.js';
import { failureState, restoredLink } from './state.js';

export type { Link };

const log = streamDeck.logger.createScope('twitch');

/** Ce qui est conserve entre deux lancements. SECRET (jetons) : voir l'en-tete. */
type Stored = {
  tokens?: Tokens;
  colorRewardId?: string;
  paused?: boolean;
  deviceIds?: string[];
};

/** Dernier rachat traite, pour que le streamer VOIE que ca marche. */
export type LastRedemption = { readonly user: string; readonly outcome: Outcome['outcome']; readonly reason?: string };

/** Tout ce que le panneau et la touche ont le droit de savoir. */
export type Status = {
  readonly link: Link;
  readonly login?: string;
  /** Present pendant l'appairage : code a saisir et page a ouvrir. */
  readonly pairing?: { readonly userCode: string; readonly verificationUri: string };
  /** Vrai quand la recompense existe chez Twitch. */
  readonly rewardReady: boolean;
  readonly paused: boolean;
  /** Code de la derniere panne, pour que le panneau l'explique. */
  readonly problem?: string;
  readonly last?: LastRedemption;
};

/** Delai maximal d'un appel reseau : Twitch ne doit jamais figer le plugin. */
const REQUEST_TIMEOUT_MS = 15_000;
/** Renouveler un peu AVANT l'expiration plutot que d'echouer sur le jeton perime. */
const REFRESH_MARGIN_MS = 5 * 60_000;
/** Reessai d'une mise en ligne qui a echoue faute de reseau. */
const NETWORK_RETRY_MS = 30_000;
/** Un rachat en attente plus jeune que cela est peut-etre en cours de traitement. */
const STALE_REDEMPTION_MS = 60_000;

/** Recompense creee : prix et delai se changent ensuite dans le tableau de bord Twitch. */
const REWARD_COST = 200;
const REWARD_COOLDOWN_SECONDS = 30;

const fetcher: Fetcher = (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

let stored: Stored = {};
let status: Status = { link: 'disconnected', rewardReady: false, paused: false };
let client: EventSubClient | undefined;
/** Etat de la liaison EN SERVICE (celui qu'on retrouve apres une annulation), pas celui qu'on affiche. */
let clientLink: Link | undefined;
let pairing: AbortController | undefined;
let retryTimer: ReturnType<typeof setTimeout> | undefined;
/** Numero de la mise en ligne courante : une attente qui revient avec un autre numero abandonne. */
let epoch = 0;
/** Renouvellement en vol, partage par tous les appelants. */
let refreshing: Promise<Tokens> | undefined;
const listeners = new Set<(status: Status) => void>();

let markReady!: () => void;
/** Resolue quand `init` a relu le disque : aucune ecriture ne doit la preceder. */
const ready = new Promise<void>((resolve) => { markReady = resolve; });

// --- Etat et diffusion -------------------------------------------------------

type Change = {
  link?: Link;
  paused?: boolean;
  pairing?: Status['pairing'] | undefined;
  problem?: string | undefined;
  last?: LastRedemption;
};

function publish(change: Change): void {
  const pairingNow = 'pairing' in change ? change.pairing : status.pairing;
  const problemNow = 'problem' in change ? change.problem : status.problem;
  const lastNow = change.last ?? status.last;
  status = {
    link: change.link ?? status.link,
    rewardReady: Boolean(stored.colorRewardId),
    paused: change.paused ?? Boolean(stored.paused),
    ...(stored.tokens ? { login: stored.tokens.login } : {}),
    ...(pairingNow ? { pairing: pairingNow } : {}),
    ...(problemNow ? { problem: problemNow } : {}),
    ...(lastNow ? { last: lastNow } : {}),
  };
  for (const listener of listeners) {
    try { listener(status); } catch (error: unknown) { log.warn('ecouteur en echec : ' + describe(error)); }
  }
}

/** Texte sur d'une erreur : jamais d'objet brut, qui pourrait citer un jeton. */
function describe(error: unknown): string {
  if (error instanceof TwitchAuthError || error instanceof HelixError) return error.code;
  return error instanceof Error ? error.name : 'erreur';
}

/**
 * Modifie l'etat persiste, a partir de la valeur DU DISQUE, apres la fin de `init`.
 *
 * `stored` n'est qu'un reflet de ce qui vient d'etre ecrit : il ne sert jamais
 * de point de depart a une ecriture (voir l'en-tete).
 */
async function mutate(change: (current: Stored) => Stored): Promise<void> {
  await ready;
  let written: Stored = stored;
  await updateGlobal<Stored>('twitch', (current) => { written = change({ ...(current ?? {}) }); return written; });
  stored = written;
}

/** Etat courant, pour afficher un panneau ou une touche qui apparait. */
export function getStatus(): Status {
  return status;
}

/** S'abonne aux changements d'etat. Rend la fonction de desabonnement. */
export function onStatus(listener: (status: Status) => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

// --- Session et appels ------------------------------------------------------

function session(tokens: Tokens): HelixSession {
  return { accessToken: tokens.accessToken, userId: tokens.userId };
}

/** Renouvelle la session ; un seul renouvellement a la fois, ecrit avant tout autre usage. */
function refreshNow(): Promise<Tokens> {
  refreshing ??= (async () => {
    const current = stored.tokens;
    if (!current) throw new TwitchAuthError('reconnect-needed');
    try {
      const next = await refreshTokens(current, { fetcher, now: Date.now });
      // Une deconnexion survenue pendant l'appel ne doit pas ressusciter la session.
      await mutate((disk) => (disk.tokens ? { ...disk, tokens: next } : disk));
      return next;
    } catch (error: unknown) {
      if (error instanceof TwitchAuthError && error.code === 'reconnect-needed') await lostSession();
      throw error;
    }
  })().finally(() => { refreshing = undefined; });
  return refreshing;
}

/** Un jeton valable, renouvele au besoin. */
async function freshTokens(): Promise<Tokens> {
  const current = stored.tokens;
  if (!current) throw new TwitchAuthError('reconnect-needed');
  return current.expiresAt - Date.now() > REFRESH_MARGIN_MS ? current : refreshNow();
}

function stopClient(): void {
  client?.stop();
  client = undefined;
  clientLink = undefined;
}

function clearRetry(): void {
  if (retryTimer !== undefined) clearTimeout(retryTimer);
  retryTimer = undefined;
}

/** La session est morte : tout arreter et demander au streamer de se reconnecter. */
async function lostSession(): Promise<void> {
  epoch += 1;
  clearRetry();
  stopClient();
  await mutate(({ tokens: _dead, ...kept }) => kept);
  publish({ link: 'auth-needed', problem: 'reconnect-needed' });
}

/**
 * Execute un appel Twitch avec la session du streamer.
 *
 * Sur un refus d'authentification, renouvelle UNE fois puis retente : un jeton
 * peut avoir ete revoque entre deux controles d'expiration.
 */
async function withHelix<T>(call: (session: HelixSession) => Promise<T>): Promise<T> {
  try {
    return await call(session(await freshTokens()));
  } catch (error: unknown) {
    if (!(error instanceof HelixError) || error.code !== 'unauthorized') throw error;
    return call(session(await refreshNow()));
  }
}

// --- Recompense --------------------------------------------------------------

function rewardDefinition(): RewardDefinition {
  return {
    title: t('twitch.reward.colorTitle'),
    cost: REWARD_COST,
    prompt: t('twitch.reward.colorPrompt'),
    cooldownSeconds: REWARD_COOLDOWN_SECONDS,
  };
}

/**
 * S'assure que la recompense « couleur » existe, et rend son identifiant.
 *
 * Reprend celle qu'on connait, sinon celle de meme titre creee par ce plugin
 * (reinstallation), sinon la cree. Un titre deja pris par une recompense qui
 * n'est PAS la notre remonte en `duplicate` : on n'y touche pas.
 */
async function ensureColorReward(): Promise<string> {
  const definition = rewardDefinition();
  const own = await withHelix((s) => listOwnRewards(s, fetcher));
  const known = own.find((r) => r.id === stored.colorRewardId) ?? own.find((r) => r.title === definition.title);
  const id = known ? known.id : (await withHelix((s) => createReward(s, definition, fetcher))).id;

  // Une deconnexion survenue pendant l'attente ne doit pas laisser un identifiant orphelin.
  await mutate((disk) => (disk.tokens ? { ...disk, colorRewardId: id } : disk));
  return id;
}

// --- Ampoules ----------------------------------------------------------------

/** Applique la couleur d'un viewer aux ampoules choisies. Vrai si au moins une a obei. */
async function applyColor(color: Hsv): Promise<boolean> {
  const coords = await coordinatesForMany({ deviceIds: stored.deviceIds ?? [] });
  if (coords.length === 0) return false;

  // Un scenario repeindrait la lampe a sa prochaine image : il s'efface devant le viewer.
  await Promise.all(coords.map((c) => stopScenario(c.id)));

  const { values, errors } = await fanOut(coords, (c) => withRetry(c, async (bulb) => {
    if (!bulb.capabilities.supportsColor) return false;
    // Allumer d'abord : une couleur appliquee a une lampe eteinte est silencieuse.
    await bulb.setPower(true);
    await bulb.setColor(color);
    return true;
  }));
  for (const failure of errors) log.warn('couleur non appliquee a ' + failure.item.id.slice(-6));
  return values.some(Boolean);
}

// --- Rachats -----------------------------------------------------------------

const handleRedemption = createRedemptionHandler({
  colorRewardId: () => stored.colorRewardId,
  enabled: () => !stored.paused,
  applyColor,
  settle: (redemption, outcome) => withHelix((s) => settleWithRetry(
    s, { redemptionId: redemption.id, rewardId: redemption.rewardId }, outcome, fetcher, wait,
  )),
  report: (outcome) => {
    // Le texte du viewer n'est pas journalise : seul le resultat l'est.
    log.info('rachat de ' + outcome.redemption.userName + ' : ' + outcome.outcome + (outcome.reason ? ' (' + outcome.reason + ')' : ''));
    publish({ last: { user: outcome.redemption.userName, outcome: outcome.outcome, ...(outcome.reason ? { reason: outcome.reason } : {}) } });
  },
});

/** Rembourse les rachats restes en attente pendant une coupure (voir l'en-tete). */
async function sweepStale(): Promise<void> {
  const rewardId = stored.colorRewardId;
  if (!rewardId) return;
  try {
    const pending = await withHelix((s) => listPendingRedemptions(s, rewardId, fetcher));
    const stale = staleRedemptions(pending, Date.now(), STALE_REDEMPTION_MS, handleRedemption.isKnown);
    let refunded = 0;
    for (const redemption of stale) {
      try {
        await withHelix((s) => settleWithRetry(s, { redemptionId: redemption.id, rewardId }, 'refund', fetcher, wait));
        refunded += 1;
      } catch (error: unknown) {
        log.warn('rachat en attente non rembourse : ' + describe(error));
      }
    }
    if (stale.length > 0) log.info('rachats restes en attente : ' + refunded + '/' + stale.length + ' rembourses');
  } catch (error: unknown) {
    log.warn('balayage des rachats en attente impossible : ' + describe(error));
  }
}

async function subscribeOnce(sessionId: string): Promise<void> {
  const rewardId = stored.colorRewardId;
  if (!rewardId) throw new HelixError('not-found');
  await withHelix((s) => subscribeToRedemptions(s, { sessionId, rewardId }, fetcher));
}

async function subscribe(sessionId: string): Promise<SubscribeResult> {
  try {
    try {
      await subscribeOnce(sessionId);
    } catch (error: unknown) {
      // Recompense supprimee dans le tableau de bord pendant que le plugin tourne :
      // on la retrouve ou on la recree, puis on retente UNE fois.
      if (!(error instanceof HelixError) || (error.code !== 'not-found' && error.code !== 'rejected')) throw error;
      await ensureColorReward();
      await subscribeOnce(sessionId);
    }
    void sweepStale();
    return 'ok';
  } catch (error: unknown) {
    log.warn('abonnement aux rachats refuse : ' + describe(error));
    const refused = error instanceof HelixError && (error.code === 'unauthorized' || error.code === 'forbidden');
    const dead = error instanceof TwitchAuthError && error.code === 'reconnect-needed';
    return refused || dead ? 'auth-needed' : 'retry';
  }
}

function linkOf(state: ClientState): Link {
  switch (state) {
    case 'connected': return 'online';
    case 'auth-needed':
    case 'revoked': return 'auth-needed';
    case 'stopped': return 'disconnected';
    default: return 'connecting';
  }
}

/** Cree la recompense au besoin puis ecoute les rachats. */
async function goOnline(): Promise<void> {
  const mine = ++epoch;
  clearRetry();
  stopClient();
  publish({ link: 'connecting', problem: undefined });

  try {
    await ensureColorReward();
    if (mine !== epoch) return;

    const next = createEventSubClient({
      openSocket: (url) => new WebSocket(url) as unknown as SocketLike,
      subscribe,
      onRedemption: (redemption) => { if (client === next) void handleRedemption(redemption); },
      onState: (state) => {
        // Une socket remplacee ne doit pas repeindre l'etat de la nouvelle.
        if (client !== next) return;
        clientLink = linkOf(state);
        publish({
          link: clientLink,
          problem: state === 'revoked' ? 'revoked' : state === 'auth-needed' ? 'reconnect-needed' : undefined,
        });
      },
      timers: { set: (callback, ms) => setTimeout(callback, ms), clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>) },
    });
    client = next;
    clientLink = 'connecting';
    next.start();
  } catch (error: unknown) {
    if (mine !== epoch) return;
    log.warn('connexion Twitch impossible : ' + describe(error));
    const code = error instanceof TwitchAuthError || error instanceof HelixError ? error.code : 'rejected';
    publish(failureState(code));
    // Seule une panne de reseau se reessaie seule : le reste attend le streamer.
    if (code === 'network') {
      retryTimer = setTimeout(() => { retryTimer = undefined; if (stored.tokens) void goOnline(); }, NETWORK_RETRY_MS);
    }
  }
}

// --- API publique ------------------------------------------------------------

/** A appeler une fois au demarrage : relit l'etat et se reconnecte si une session existe. */
export async function init(): Promise<void> {
  try {
    stored = (await readGlobal<Stored>('twitch')) ?? {};
  } catch (error: unknown) {
    log.warn('lecture de l\'etat Twitch impossible : ' + describe(error));
    stored = {};
  } finally {
    markReady();
  }
  publish({ link: stored.tokens ? 'connecting' : 'disconnected' });
  if (stored.tokens) void goOnline();
}

/** Arrete l'ecoute (extinction du plugin). */
export function shutdown(): void {
  epoch += 1;
  clearRetry();
  pairing?.abort();
  pairing = undefined;
  stopClient();
}

/** Interrompt un appairage en cours et retrouve l'etat d'avant. */
export function cancelPairing(): void {
  if (!pairing) return;
  pairing.abort();
  pairing = undefined;
  publish({ link: restoredLink(Boolean(stored.tokens), clientLink), pairing: undefined, problem: undefined });
}

/** Attente qui s'interrompt des que l'appairage est annule : le bouton Annuler agit tout de suite. */
function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
  });
}

/**
 * Lance la connexion : code a saisir sur twitch.tv, puis attente de l'autorisation.
 *
 * Rend la main des que le code est affichable ; la suite se lit dans `onStatus`.
 */
export async function beginPairing(): Promise<void> {
  cancelPairing();
  const controller = new AbortController();
  pairing = controller;
  /** Faux des qu'un autre appairage, une annulation ou une deconnexion a pris la suite. */
  const current = (): boolean => pairing === controller && !controller.signal.aborted;

  try {
    const device = await startDeviceFlow(fetcher);
    if (!current()) return;
    publish({ link: 'pairing', pairing: { userCode: device.userCode, verificationUri: device.verificationUri }, problem: undefined });
    // Ouvrir la page evite au streamer de copier le code : l'adresse le porte deja.
    void streamDeck.system.openUrl(device.verificationUri).catch(() => undefined);

    const tokens = await pollDeviceFlow(device, {
      fetcher,
      now: Date.now,
      sleep: (ms) => abortableSleep(ms, controller.signal),
      signal: controller.signal,
    });
    if (!current()) {
      // Annule a l'instant ou Twitch repondait : cette session ne doit pas rester valable.
      void revokeToken(tokens.accessToken, fetcher).catch(() => undefined);
      return;
    }

    const previous = stored.tokens;
    await mutate((disk) => ({ ...disk, tokens }));
    pairing = undefined;
    // Remplacer une session sans revoquer l'ancienne laisserait deux acces valables.
    if (previous) void revokeToken(previous.accessToken, fetcher).catch(() => undefined);
    publish({ pairing: undefined });
    await goOnline();
  } catch (error: unknown) {
    // Remplace ou annule : celui qui a pris la suite parle, pas nous.
    if (pairing !== controller) return;
    pairing = undefined;
    const cancelled = error instanceof TwitchAuthError && error.code === 'cancelled';
    if (!cancelled) log.warn('appairage Twitch echoue : ' + describe(error));
    publish({
      link: restoredLink(Boolean(stored.tokens), clientLink),
      pairing: undefined,
      problem: cancelled ? undefined : describe(error),
    });
  }
}

/** Relance la mise en ligne apres un blocage que le streamer vient de lever (titre libere, par exemple). */
export async function retry(): Promise<void> {
  if (stored.tokens) await goOnline();
}

/** Retire la session, la recompense, et l'autorisation chez Twitch. Au mieux : un echec reseau n'empeche pas de partir. */
export async function disconnect(): Promise<void> {
  cancelPairing();
  epoch += 1;
  clearRetry();
  stopClient();

  const rewardId = stored.colorRewardId;
  let live = stored.tokens;
  if (live) {
    // Renouveler d'abord : revoquer un jeton perime laisserait le courant valable.
    try { live = await freshTokens(); } catch (error: unknown) { log.warn('session non renouvelee avant la deconnexion : ' + describe(error)); }
  }
  if (live && rewardId) {
    try { await deleteReward(session(live), rewardId, fetcher); } catch (error: unknown) { log.warn('recompense non supprimee : ' + describe(error)); }
  }
  if (live) {
    try { await revokeToken(live.accessToken, fetcher); } catch (error: unknown) { log.warn('autorisation non revoquee : ' + describe(error)); }
  }

  await mutate(({ tokens: _tokens, colorRewardId: _reward, ...kept }) => kept);
  publish({ link: 'disconnected', problem: undefined });
}

/** Choisit les ampoules des viewers. Conservees pour le prochain lancement. */
export async function setBulbs(deviceIds: string[]): Promise<void> {
  await ready;
  if ((stored.deviceIds ?? []).join() === deviceIds.join()) return;
  await mutate((disk) => ({ ...disk, deviceIds }));
}

/** Met les viewers en pause (tout rachat est rembourse) ou les reactive. */
export async function setPaused(paused: boolean): Promise<void> {
  await mutate((disk) => ({ ...disk, paused }));
  publish({ paused });
}

export async function togglePaused(): Promise<boolean> {
  await ready;
  await setPaused(!stored.paused);
  return Boolean(stored.paused);
}
