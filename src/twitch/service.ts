/**
 * Service Twitch du plugin : relie la session du streamer, les recompenses, la
 * socket de rachats et les ampoules.
 *
 * Ce que fait ce module : quand un viewer depense ses points, appliquer la
 * couleur ou lancer le scenario achete, puis valider le rachat — ou le
 * rembourser.
 *
 * Il ne contient AUCUNE regle metier : le catalogue des recompenses et la duree
 * d'un scenario sont dans rewards.ts, la lecture d'une couleur tapee dans
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
 *     payer pour rien. Ampoules visees, choix des recompenses et pause sont donc
 *     PERSISTES, et relus au demarrage.
 *
 *   - Les recompenses chez Twitch SUIVENT le panneau : cocher une couleur la
 *     cree, la decocher la supprime. Seules les recompenses creees par ce plugin
 *     sont touchees — les autres ne sont pas gerables par lui, et ne nous
 *     regardent pas. La synchronisation est differee d'un instant apres un
 *     changement, pour ne pas creer puis supprimer a chaque clic, et SERIALISEE :
 *     deux synchronisations simultanees creeraient deux fois la meme recompense
 *     (Twitch refuse la seconde) et la derniere ecrite oublierait celles de
 *     l'autre. Un changement fait pendant la connexion est rejoue a la fin.
 *
 *   - Une recompense au titre deja pris n'empeche pas les autres de
 *     fonctionner : la liaison reste « en ligne » et seul le probleme est
 *     signale (`rewardsProblem`, unique source de cette information).
 *
 *   - L'abonnement couvre toute la chaine (un abonnement par recompense
 *     obligerait a suivre chaque case du panneau). Un rachat d'une recompense
 *     qui n'est pas au plugin est ignore sans etre lu ni journalise.
 *
 *   - AUCUNE ecriture n'a lieu avant la fin de `init`, et chaque ecriture part
 *     de la valeur DU DISQUE (voir global-store.ts), jamais d'un instantane en
 *     memoire : une touche affichee des le lancement ne peut pas ecraser la
 *     session persistee.
 *
 *   - Une « epoque » numerote chaque mise en ligne : une attente reseau qui
 *     revient apres une deconnexion, une session perdue ou une seconde mise en
 *     ligne abandonne, sans laisser de socket orpheline.
 *
 *   - Le jeton de renouvellement est a usage unique : tout renouvellement est
 *     serialise (un seul en vol) et ECRIT avant d'etre utilise.
 *
 *   - Un rachat paye pendant une coupure reste « en attente » chez Twitch :
 *     EventSub ne rejoue rien. A chaque abonnement, on rembourse ceux que le
 *     plugin n'a pas vus et qui ont plus d'une minute.
 *
 *   - Un scenario en cours sur une ampoule visee est ARRETE avant d'appliquer
 *     une couleur : sa prochaine image effacerait sinon le choix du viewer.
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
import { SCENARIOS, byId } from '../scenarios/catalogue.js';
import { start as startScenario, stop as stopScenario } from '../scenarios/runner.js';
import {
  TwitchAuthError, pollDeviceFlow, refreshTokens, revokeToken, startDeviceFlow,
  type Fetcher, type Tokens,
} from './auth.js';
import { createEventSubClient, type ClientState, type EventSubClient, type SocketLike, type SubscribeResult } from './eventsub.js';
import type { Link } from './face.js';
import { createRedemptionHandler, staleRedemptions, type Outcome } from './handler.js';
import {
  HelixError, createReward, deleteReward, listOwnRewards, listPendingRedemptions, settleWithRetry, subscribeToRedemptions,
  type HelixSession,
} from './helix.js';
import { actionFor, normalizeConfig, planRewards, scenarioDuration, wantedRewards, type TwitchConfig } from './rewards.js';
import { failureState, restoredLink } from './state.js';

export type { Link };

const log = streamDeck.logger.createScope('twitch');

/** Ce qui est conserve entre deux lancements. SECRET (jetons) : voir l'en-tete. */
type Stored = {
  tokens?: Tokens;
  /** Cle de recompense (`color:rouge`, `free`...) -> identifiant chez Twitch. */
  rewardIds?: Record<string, string>;
  /** @deprecated Une seule recompense « couleur » avant la palette. Reprise comme `free`. */
  colorRewardId?: string;
  paused?: boolean;
  deviceIds?: string[];
  /** Choix du panneau, tels quels : `normalizeConfig` les nettoie a chaque lecture. */
  config?: unknown;
};

/** Un rachat recent, pour que le streamer VOIE que ca marche. */
export type HistoryEntry = {
  readonly user: string;
  /** Ce qui a ete achete : titre de la recompense, et texte tape pour la saisie libre. */
  readonly what: string;
  readonly outcome: Outcome['outcome'];
  readonly reason?: string;
};

/** Tout ce que le panneau et la touche ont le droit de savoir. */
export type Status = {
  readonly link: Link;
  readonly login?: string;
  /** Present pendant l'appairage : code a saisir et page a ouvrir. */
  readonly pairing?: { readonly userCode: string; readonly verificationUri: string };
  /** Vrai quand au moins une recompense existe chez Twitch. */
  readonly rewardReady: boolean;
  readonly paused: boolean;
  /** Code de la derniere panne, pour que le panneau l'explique. */
  readonly problem?: string;
  /** Les derniers rachats, le plus recent en tete. */
  readonly history: readonly HistoryEntry[];
};

/** Delai maximal d'un appel reseau : Twitch ne doit jamais figer le plugin. */
const REQUEST_TIMEOUT_MS = 15_000;
/** Renouveler un peu AVANT l'expiration plutot que d'echouer sur le jeton perime. */
const REFRESH_MARGIN_MS = 5 * 60_000;
/** Reessai d'une mise en ligne qui a echoue faute de reseau. */
const NETWORK_RETRY_MS = 30_000;
/** Un rachat en attente plus jeune que cela est peut-etre en cours de traitement. */
const STALE_REDEMPTION_MS = 60_000;
/** Attente apres un changement de panneau avant de synchroniser les recompenses. */
const SYNC_DELAY_MS = 1500;
/** Rachats gardes pour l'historique du panneau. */
const HISTORY_SIZE = 5;
/** Longueur montree d'un texte de viewer dans l'historique. */
const HISTORY_TEXT_MAX = 30;

const SCENARIO_IDS = SCENARIOS.map((s) => s.id);

const fetcher: Fetcher = (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

let stored: Stored = {};
let status: Status = { link: 'disconnected', rewardReady: false, paused: false, history: [] };
let client: EventSubClient | undefined;
/** Etat de la liaison EN SERVICE (celui qu'on retrouve apres une annulation), pas celui qu'on affiche. */
let clientLink: Link | undefined;
let pairing: AbortController | undefined;
let retryTimer: ReturnType<typeof setTimeout> | undefined;
let syncTimer: ReturnType<typeof setTimeout> | undefined;
/** File des synchronisations : une seule a la fois, chacune relit la configuration a son tour. */
let syncing: Promise<void> = Promise.resolve();
/** Un changement de panneau attend que la liaison soit en service pour etre synchronise. */
let syncDirty = false;
/** Panne de la derniere synchronisation qui n'empeche pas d'ecouter (`duplicate`), ou undefined. */
let rewardsProblem: string | undefined;
/** Numero de la mise en ligne courante : une attente qui revient avec un autre numero abandonne. */
let epoch = 0;
/** Renouvellement en vol, partage par tous les appelants. */
let refreshing: Promise<Tokens> | undefined;
const listeners = new Set<(status: Status) => void>();

let markReady!: () => void;
/** Resolue quand `init` a relu le disque : aucune ecriture ne doit la preceder. */
const ready = new Promise<void>((resolve) => { markReady = resolve; });

// --- Etat et diffusion -------------------------------------------------------

/** Recompenses connues, l'ancienne recompense unique comprise. */
function rewardIds(from: Stored = stored): Record<string, string> {
  if (from.rewardIds) return from.rewardIds;
  return from.colorRewardId ? { free: from.colorRewardId } : {};
}

function config(): TwitchConfig {
  return normalizeConfig(stored.config, SCENARIO_IDS);
}

type Change = {
  link?: Link;
  paused?: boolean;
  pairing?: Status['pairing'] | undefined;
  problem?: string | undefined;
  history?: readonly HistoryEntry[];
};

function publish(change: Change): void {
  const pairingNow = 'pairing' in change ? change.pairing : status.pairing;
  const problemNow = 'problem' in change ? change.problem : status.problem;
  status = {
    link: change.link ?? status.link,
    rewardReady: Object.keys(rewardIds()).length > 0,
    paused: change.paused ?? Boolean(stored.paused),
    ...(stored.tokens ? { login: stored.tokens.login } : {}),
    ...(pairingNow ? { pairing: pairingNow } : {}),
    ...(problemNow ? { problem: problemNow } : {}),
    history: change.history ?? status.history,
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

function clearTimers(): void {
  if (retryTimer !== undefined) clearTimeout(retryTimer);
  if (syncTimer !== undefined) clearTimeout(syncTimer);
  retryTimer = undefined;
  syncTimer = undefined;
}

/** La session est morte : tout arreter et demander au streamer de se reconnecter. */
async function lostSession(): Promise<void> {
  epoch += 1;
  clearTimers();
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

// --- Recompenses -------------------------------------------------------------

/**
 * Fait correspondre les recompenses de la chaine aux choix du panneau (voir
 * `planRewards`), dans la file des synchronisations.
 *
 * Une creation qui echoue (titre deja pris par une recompense qui n'est PAS la
 * notre : `duplicate`) n'empeche pas les autres ; la premiere panne est rendue a
 * la fin. Une suppression qui echoue GARDE sa cle : la recompense reste active
 * chez Twitch, ses rachats doivent continuer d'etre traites (et balayes), et la
 * prochaine synchronisation retentera de la supprimer.
 */
function syncRewards(): Promise<void> {
  const run = syncing.then(syncNow, syncNow);
  syncing = run.then(() => undefined, () => undefined);
  return run;
}

async function syncNow(): Promise<void> {
  if (!stored.tokens) return;
  const own = await withHelix((s) => listOwnRewards(s, fetcher));
  const plan = planRewards(wantedRewards(config(), t), own, rewardIds());
  const next: Record<string, string> = { ...plan.keep };
  let firstError: unknown;

  for (const spec of plan.create) {
    // Une deconnexion survenue entre deux creations arrete la synchronisation.
    if (!stored.tokens) break;
    try {
      const created = await withHelix((s) => createReward(s, {
        title: spec.title, cost: spec.cost, prompt: spec.prompt, cooldownSeconds: spec.cooldownSeconds, userInput: spec.userInput,
      }, fetcher));
      next[spec.key] = created.id;
    } catch (error: unknown) {
      log.warn('recompense non creee (' + spec.key + ') : ' + describe(error));
      firstError ??= error;
    }
  }
  for (const { key, id } of plan.remove) {
    if (!stored.tokens) { next[key] = id; continue; }
    try {
      await withHelix((s) => deleteReward(s, id, fetcher));
    } catch (error: unknown) {
      log.warn('recompense non supprimee : ' + describe(error));
      next[key] = id;
    }
  }

  // Une deconnexion survenue pendant l'attente ne doit pas laisser des identifiants orphelins.
  await mutate((disk) => {
    if (!disk.tokens) return disk;
    const { colorRewardId: _legacy, ...rest } = disk;
    return { ...rest, rewardIds: next };
  });
  if (firstError !== undefined) throw firstError;
}

/** Applique le resultat d'une synchronisation : seuls les refus de session coupent l'ecoute. */
function settleSync(error: unknown): void {
  if (error === undefined) {
    rewardsProblem = undefined;
    publish({ problem: undefined });
    return;
  }
  const code = describe(error);
  if (code === 'reconnect-needed' || code === 'unauthorized') {
    publish(failureState(code));
    return;
  }
  // Titre deja pris, reseau, limitation : l'ecoute continue, le panneau le dit.
  rewardsProblem = code;
  publish({ problem: code });
}

/** Synchronise un instant apres le dernier changement ; hors ligne, a la prochaine mise en service. */
function scheduleSync(): void {
  if (syncTimer !== undefined) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    syncTimer = undefined;
    if (!stored.tokens) return;
    if (clientLink !== 'online') { syncDirty = true; return; }
    const mine = epoch;
    void syncRewards().then(
      () => { if (mine === epoch) settleSync(undefined); },
      (error: unknown) => { if (mine === epoch) settleSync(error); },
    );
  }, SYNC_DELAY_MS);
}

/** La recompense rachetee, si elle est au plugin. */
function keyOf(rewardId: string): string | undefined {
  return Object.entries(rewardIds()).find(([, id]) => id === rewardId)?.[0];
}

// --- Ampoules ----------------------------------------------------------------

async function targets() {
  return coordinatesForMany({ deviceIds: stored.deviceIds ?? [] });
}

/** Applique une couleur aux ampoules choisies. Vrai si au moins une a obei. */
async function applyColor(color: Hsv): Promise<boolean> {
  const coords = await targets();
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

/** Lance un scenario pour une duree tiree du prix paye ; les lampes reviennent ensuite a leur etat. */
async function playScenario(scenarioId: string, cost: number): Promise<boolean> {
  const scenario = byId(scenarioId);
  const coords = await targets();
  if (!scenario || coords.length === 0) return false;
  const { together, secondsPer100, maxSeconds } = config();
  const played = await startScenario(scenario, coords, { together, maxMs: scenarioDuration(cost, secondsPer100, maxSeconds) });
  // Aucune lampe n'a recu la premiere image : on n'insiste pas, le viewer sera rembourse.
  if (!played) await stopScenario(coords[0]?.id);
  return played;
}

// --- Rachats -----------------------------------------------------------------

function describeRedemption(outcome: Outcome): string {
  const { rewardTitle, userInput } = outcome.redemption;
  const typed = userInput.trim();
  if (!typed) return rewardTitle;
  const shown = typed.length > HISTORY_TEXT_MAX ? typed.slice(0, HISTORY_TEXT_MAX - 1) + '…' : typed;
  return rewardTitle + ' · « ' + shown + ' »';
}

const handleRedemption = createRedemptionHandler({
  actionFor: (rewardId) => {
    const key = keyOf(rewardId);
    return key ? actionFor(key) : undefined;
  },
  enabled: () => !stored.paused,
  applyColor,
  playScenario,
  settle: (redemption, outcome) => withHelix((s) => settleWithRetry(
    s, { redemptionId: redemption.id, rewardId: redemption.rewardId }, outcome, fetcher, wait,
  )),
  report: (outcome) => {
    // Le texte du viewer n'est pas journalise : seul le resultat l'est.
    log.info('rachat de ' + outcome.redemption.userName + ' : ' + outcome.outcome + (outcome.reason ? ' (' + outcome.reason + ')' : ''));
    const entry: HistoryEntry = {
      user: outcome.redemption.userName,
      what: describeRedemption(outcome),
      outcome: outcome.outcome,
      ...(outcome.reason ? { reason: outcome.reason } : {}),
    };
    publish({ history: [entry, ...status.history].slice(0, HISTORY_SIZE) });
  },
});

/** Rembourse les rachats restes en attente pendant une coupure (voir l'en-tete). */
async function sweepStale(): Promise<void> {
  for (const rewardId of Object.values(rewardIds())) {
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
}

async function subscribe(sessionId: string): Promise<SubscribeResult> {
  try {
    await withHelix((s) => subscribeToRedemptions(s, { sessionId }, fetcher));
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

/** Synchronise les recompenses puis ecoute les rachats. */
async function goOnline(): Promise<void> {
  const mine = ++epoch;
  clearTimers();
  stopClient();
  publish({ link: 'connecting', problem: undefined });

  syncDirty = false;
  try {
    await syncRewards();
    rewardsProblem = undefined;
  } catch (error: unknown) {
    if (mine !== epoch) return;
    const code = describe(error);
    // Une recompense au titre deja pris n'empeche pas les autres de fonctionner :
    // on ecoute quand meme, et le panneau le signale.
    if (code !== 'duplicate') return failOnline(code);
    rewardsProblem = code;
  }
  if (mine !== epoch) return;

  const next = createEventSubClient({
    openSocket: (url) => new WebSocket(url) as unknown as SocketLike,
    subscribe,
    onRedemption: (redemption) => { if (client === next) void handleRedemption(redemption); },
    onState: (state) => {
      // Une socket remplacee ne doit pas repeindre l'etat de la nouvelle.
      if (client !== next) return;
      clientLink = linkOf(state);
      const problem = state === 'revoked' ? 'revoked' : state === 'auth-needed' ? 'reconnect-needed' : rewardsProblem;
      publish({ link: clientLink, problem });
      // Un changement de panneau fait pendant la connexion est rejoue maintenant.
      if (clientLink === 'online' && syncDirty) { syncDirty = false; scheduleSync(); }
    },
    timers: { set: (callback, ms) => setTimeout(callback, ms), clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>) },
  });
  client = next;
  clientLink = 'connecting';
  next.start();
}

function failOnline(code: string): void {
  log.warn('connexion Twitch impossible : ' + code);
  publish(failureState(code));
  // Seule une panne de reseau se reessaie seule : le reste attend le streamer.
  if (code === 'network') {
    retryTimer = setTimeout(() => { retryTimer = undefined; if (stored.tokens) void goOnline(); }, NETWORK_RETRY_MS);
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
  clearTimers();
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

/** Retire la session, les recompenses, et l'autorisation chez Twitch. Au mieux : un echec reseau n'empeche pas de partir. */
export async function disconnect(): Promise<void> {
  cancelPairing();
  epoch += 1;
  clearTimers();
  stopClient();

  // Laisser finir une synchronisation en cours : elle a peut-etre cree des
  // recompenses que l'instantane ci-dessous doit voir pour les supprimer.
  await syncing;
  const ids = Object.values(rewardIds());
  let live = stored.tokens;
  if (live) {
    // Renouveler d'abord : revoquer un jeton perime laisserait le courant valable.
    try { live = await freshTokens(); } catch (error: unknown) { log.warn('session non renouvelee avant la deconnexion : ' + describe(error)); }
  }
  if (live) {
    for (const id of ids) {
      try { await deleteReward(session(live), id, fetcher); } catch (error: unknown) { log.warn('recompense non supprimee : ' + describe(error)); }
    }
    try { await revokeToken(live.accessToken, fetcher); } catch (error: unknown) { log.warn('autorisation non revoquee : ' + describe(error)); }
  }

  await mutate(({ tokens: _tokens, rewardIds: _rewards, colorRewardId: _legacy, ...kept }) => kept);
  publish({ link: 'disconnected', problem: undefined });
}

/** Reglages de la touche Twitch : ampoules visees et choix des recompenses. Conserves pour le prochain lancement. */
export async function configure(settings: { deviceIds: string[]; config: Record<string, unknown> }): Promise<void> {
  await ready;
  const nextConfig = normalizeConfig(settings.config, SCENARIO_IDS);
  const sameBulbs = (stored.deviceIds ?? []).join() === settings.deviceIds.join();
  const sameConfig = JSON.stringify(config()) === JSON.stringify(nextConfig);
  if (sameBulbs && sameConfig) return;
  await mutate((disk) => ({ ...disk, deviceIds: settings.deviceIds, config: nextConfig }));
  if (!sameConfig) scheduleSync();
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
