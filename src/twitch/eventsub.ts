/**
 * Connexion temps reel a Twitch (EventSub en WebSocket) qui ne meurt pas en silence.
 *
 * Ce que fait ce module : ouvrir la socket, s'abonner aux rachats de points,
 * transmettre chaque rachat, et se reconnecter seul quand la liaison tombe.
 *
 * Choix non evidents :
 *
 *   - Un CHIEN DE GARDE sur le silence. Twitch envoie un message au moins toutes
 *     les `keepalive_timeout_seconds`. Une socket TCP peut mourir sans que
 *     personne ne le sache (box redemarree, veille) : sans cette minuterie, le
 *     plugin croirait ecouter alors que plus aucun rachat n'arrive, et les
 *     viewers paieraient dans le vide. Le delai porte une marge de 2 s.
 *
 *   - La demande de reconnexion de Twitch (`session_reconnect`) ouvre la
 *     NOUVELLE socket sans fermer l'ancienne : on ne ferme celle-ci qu'a la
 *     bienvenue de la nouvelle, sinon un rachat tombant entre les deux serait
 *     perdu. Les abonnements sont conserves par Twitch : on ne se reabonne pas.
 *
 *   - Une reconnexion APRES COUPURE repart de zero (nouvelle session, nouvel
 *     abonnement), avec un delai qui double de 1 s a 60 s. Un serveur ou une
 *     connexion en difficulte ne doit pas etre martele ; une connexion reussie
 *     remet le delai au minimum.
 *
 *   - Un jeton refuse a l'abonnement (`auth-needed`) ou une revocation
 *     (`revoked`) ARRETENT la boucle. Reessayer ne servirait a rien tant que le
 *     streamer n'a pas reautorise, et marteler Twitch avec un jeton mort est le
 *     meilleur moyen de se faire limiter.
 *
 * Invariant : aucune minuterie ni socket ne survit a `stop()`, et les
 * evenements d'une socket qu'on a quittee sont ignores (sinon sa fermeture
 * tardive declencherait une reconnexion parasite).
 *
 * La socket, l'horloge et l'abonnement sont injectes : le module n'importe ni
 * le SDK, ni le reseau, et se teste avec une fausse socket.
 *
 * Usage canonique :
 *   const client = createEventSubClient({ openSocket, subscribe, onRedemption, onState, timers });
 *   client.start();
 */
import { parseMessage, type Redemption } from './protocol.ts';

export const EVENTSUB_URL = 'wss://eventsub.wss.twitch.tv/ws';

/** Ce que le module exige d'une socket ; un `WebSocket` standard convient apres adaptation. */
export type SocketLike = {
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event: { code: number }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  close(code?: number): void;
};

export type ClientState = 'connecting' | 'connected' | 'reconnecting' | 'auth-needed' | 'revoked' | 'stopped';

/** Resultat d'un abonnement : bon, a reessayer plus tard, ou jeton a refaire. */
export type SubscribeResult = 'ok' | 'retry' | 'auth-needed';

export type Timers = {
  set(callback: () => void, ms: number): unknown;
  clear(handle: unknown): void;
};

export type EventSubDeps = {
  readonly openSocket: (url: string) => SocketLike;
  readonly subscribe: (sessionId: string) => Promise<SubscribeResult>;
  readonly onRedemption: (redemption: Redemption) => void;
  readonly onState: (state: ClientState) => void;
  readonly timers: Timers;
};

/** Marge ajoutee au delai annonce par Twitch avant de declarer la liaison morte. */
const MARGIN_MS = 2000;
/** Twitch ferme une socket sans abonnement au bout de 10 s. */
const WELCOME_WAIT_MS = 10_000 + MARGIN_MS;
const BACKOFF_MIN_MS = 1000;
const BACKOFF_MAX_MS = 60_000;

export type EventSubClient = {
  start(): void;
  stop(): void;
};

export function createEventSubClient(deps: EventSubDeps): EventSubClient {
  const { timers } = deps;

  let state: ClientState = 'stopped';
  let active = false;
  /** Socket dont on traite les messages. */
  let current: SocketLike | undefined;
  /** Socket ouverte a la demande de Twitch, en attente de sa bienvenue. */
  let pending: SocketLike | undefined;
  let watchdog: unknown;
  let retryTimer: unknown;
  let failures = 0;
  /** Silence tolerable sur la socket en service, fixe a la bienvenue d'apres l'annonce de Twitch. */
  let keepaliveMs = WELCOME_WAIT_MS;

  function setState(next: ClientState): void {
    if (state === next) return;
    state = next;
    deps.onState(next);
  }

  /** Detache une socket de nos gestionnaires puis la ferme : sa fermeture ne doit plus rien declencher. */
  function discard(socket: SocketLike | undefined, code = 1000): void {
    if (!socket) return;
    socket.onmessage = null;
    socket.onclose = null;
    socket.onerror = null;
    try { socket.close(code); } catch { /* deja fermee */ }
  }

  function clearTimers(): void {
    if (watchdog !== undefined) timers.clear(watchdog);
    if (retryTimer !== undefined) timers.clear(retryTimer);
    watchdog = undefined;
    retryTimer = undefined;
  }

  function arm(ms: number): void {
    if (watchdog !== undefined) timers.clear(watchdog);
    watchdog = timers.set(() => { watchdog = undefined; lost(); }, ms);
  }

  /** La liaison est perdue : tout fermer et reprogrammer une connexion. */
  function lost(): void {
    if (!active) return;
    discard(current);
    discard(pending);
    current = undefined;
    pending = undefined;
    if (watchdog !== undefined) timers.clear(watchdog);
    watchdog = undefined;
    if (retryTimer !== undefined) return;

    setState('reconnecting');
    const delay = Math.min(BACKOFF_MIN_MS * 2 ** failures, BACKOFF_MAX_MS);
    failures += 1;
    retryTimer = timers.set(() => { retryTimer = undefined; connect(); }, delay);
  }

  function halt(next: 'auth-needed' | 'revoked'): void {
    active = false;
    clearTimers();
    discard(current);
    discard(pending);
    current = undefined;
    pending = undefined;
    setState(next);
  }

  function attach(socket: SocketLike): void {
    socket.onmessage = (event) => receive(socket, event.data);
    socket.onclose = () => {
      // La nouvelle socket d'une bascule qui echoue AVANT sa bienvenue n'emporte
      // pas l'ancienne, qui sert encore : Twitch la fermera lui-meme, et c'est
      // sa fermeture qui declenchera alors la reprise.
      if (socket === pending) { pending = undefined; return; }
      if (socket === current) lost();
    };
    socket.onerror = () => { /* la fermeture qui suit declenche la reprise */ };
  }

  function connect(): void {
    if (!active) return;
    setState('connecting');
    let socket: SocketLike;
    try {
      socket = deps.openSocket(EVENTSUB_URL);
    } catch {
      // Une socket impossible a ouvrir (adresse refusee, ressources) se traite
      // comme une liaison perdue : on retente, on ne fait pas tomber le plugin.
      lost();
      return;
    }
    current = socket;
    attach(socket);
    arm(WELCOME_WAIT_MS);
  }

  async function subscribe(socket: SocketLike, sessionId: string): Promise<void> {
    let result: SubscribeResult;
    try {
      result = await deps.subscribe(sessionId);
    } catch {
      result = 'retry';
    }
    // La socket a pu etre quittee, ou le client arrete, pendant l'attente.
    if (!active || socket !== current) return;

    if (result === 'auth-needed') return halt('auth-needed');
    if (result === 'retry') return lost();
    failures = 0;
    setState('connected');
  }

  function receive(socket: SocketLike, data: unknown): void {
    if (!active || (socket !== current && socket !== pending)) return;
    const message = parseMessage(typeof data === 'string' ? data : String(data));

    switch (message.kind) {
      case 'welcome':
        if (socket === pending) {
          // Bascule : la nouvelle socket est prete, l'ancienne peut partir.
          discard(current);
          current = socket;
          pending = undefined;
          keepaliveMs = message.keepaliveSeconds * 1000 + MARGIN_MS;
          arm(keepaliveMs);
          setState('connected');
        } else {
          keepaliveMs = message.keepaliveSeconds * 1000 + MARGIN_MS;
          arm(keepaliveMs);
          void subscribe(socket, message.sessionId);
        }
        return;
      case 'reconnect':
        if (pending === undefined) {
          try {
            pending = deps.openSocket(message.url);
            attach(pending);
          } catch {
            // La bascule echoue : l'ancienne socket sert jusqu'a sa fermeture.
            pending = undefined;
          }
        }
        return;
      case 'revoked':
        return halt('revoked');
      case 'invalid':
        // Un message illisible ne prouve pas que la liaison vit.
        return;
      case 'redemption':
        deps.onRedemption(message.redemption);
        break;
      default:
        break;
    }
    // Tout message valide de la socket en service prouve qu'elle vit.
    if (socket === current && watchdog !== undefined) arm(keepaliveMs);
  }

  return {
    start(): void {
      if (active) return;
      active = true;
      failures = 0;
      connect();
    },
    stop(): void {
      active = false;
      clearTimers();
      discard(current);
      discard(pending);
      current = undefined;
      pending = undefined;
      setState('stopped');
    },
  };
}
