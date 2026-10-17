/**
 * Decision prise pour chaque rachat de points de chaine.
 *
 * Ce que fait ce module : pour un rachat recu, appliquer la couleur demandee
 * puis valider le rachat, OU rembourser le viewer en disant pourquoi.
 *
 * Choix non evidents :
 *
 *   - Un viewer ne perd JAMAIS ses points pour rien. Texte illisible, couleur
 *     trop sombre, ampoules injoignables, plugin en pause, plantage en route :
 *     tout cela finit par un remboursement. Seule la couleur effectivement
 *     appliquee est validee (points gardes par le streamer).
 *
 *   - Les rachats sont traites UN PAR UN, dans l'ordre d'arrivee. Deux viewers
 *     qui rachetent a la meme seconde sinon se disputeraient les ampoules, et la
 *     couleur finale ne dirait pas qui a gagne. La file est BORNEE (MAX_QUEUED) :
 *     au-dela, un rachat est rembourse aussitot (`busy`).
 *
 *   - Chaque identifiant de rachat n'est traite qu'UNE fois. Apres une
 *     reconnexion, Twitch peut renvoyer un rachat deja vu ; le rejouer
 *     appliquerait deux fois la couleur et tenterait de cloturer deux fois un
 *     rachat deja clos (Twitch refuse, et on croirait a une panne).
 *
 *   - Si la CLOTURE echoue alors que la couleur est appliquee, on ne pretend
 *     pas que tout va bien : l'evenement `unsettled` laisse le streamer voir
 *     qu'un rachat reste a regler a la main dans le tableau de bord Twitch.
 *
 * Invariant : le gestionnaire retourne par `createRedemptionHandler` ne leve
 * jamais et ne reste jamais bloque : une erreur d'un rachat n'empeche pas le
 * suivant. Il n'importe ni le SDK ni le reseau — les effets sont injectes, ce
 * qui permet de tester chaque cas de remboursement sans Twitch ni ampoule.
 *
 * Usage canonique :
 *   const handle = createRedemptionHandler({ actionFor, enabled, applyColor, playScenario, settle, report });
 *   socket.onRedemption = (redemption) => void handle(redemption);
 */
import type { Hsv } from '../driver/types.ts';
import type { Redemption } from './protocol.ts';
import { surpriseColor, type RewardAction } from './rewards.ts';
import { parseViewerColor, type RejectReason } from './viewer-color.ts';

/** Pourquoi un viewer a ete rembourse. */
export type RefundReason = RejectReason | 'paused' | 'bulbs-unreachable' | 'busy';

/** Ce qui s'est passe pour un rachat, pour le journal et pour la touche. */
export type Outcome =
  | { readonly redemption: Redemption; readonly outcome: 'applied'; readonly reason?: undefined; readonly action: RewardAction; readonly color?: Hsv }
  | { readonly redemption: Redemption; readonly outcome: 'refunded'; readonly reason: RefundReason }
  /** La couleur est appliquee mais Twitch n'a pas accepte la cloture : a regler a la main. */
  | { readonly redemption: Redemption; readonly outcome: 'unsettled'; readonly reason?: undefined }
  /** Le remboursement a ete refuse : la couleur n'a PAS ete posee, mais le viewer est toujours debite. */
  | { readonly redemption: Redemption; readonly outcome: 'refund-failed'; readonly reason: RefundReason };

export type HandlerDeps = {
  /** Ce que declenche la recompense rachetee, ou undefined si elle n'est pas au plugin : le rachat est alors ignore. */
  readonly actionFor: (rewardId: string) => RewardAction | undefined;
  /** Faux quand le streamer a mis les viewers en pause. */
  readonly enabled: () => boolean;
  /** Applique la couleur a toutes les ampoules visees. Vrai si au moins une a obei. */
  readonly applyColor: (color: Hsv) => Promise<boolean>;
  /** Lance un scenario pour une duree tiree du prix paye. Vrai s'il a demarre. */
  readonly playScenario: (scenarioId: string, cost: number) => Promise<boolean>;
  /** Tirage de la couleur surprise, dans [0, 1). Absent : Math.random. */
  readonly random?: () => number;
  /** Cloture le rachat chez Twitch : `refund` rend les points, `fulfil` les garde. */
  readonly settle: (redemption: Redemption, outcome: 'refund' | 'fulfil') => Promise<void>;
  readonly report: (outcome: Outcome) => void;
};

/** Combien d'identifiants on retient pour reconnaitre un rachat rejoue. */
const REMEMBERED = 200;

/**
 * Rachats au plus en attente. Au-dela, les suivants sont rembourses tout de
 * suite : des ampoules muettes (5 s par essai) feraient sinon attendre chaque
 * viewer de longues minutes avant de savoir que son achat n'a rien donne.
 */
const MAX_QUEUED = 10;

/** Monte le gestionnaire de rachats. */
export function createRedemptionHandler(deps: HandlerDeps): ((redemption: Redemption) => Promise<void>) & { isKnown(id: string): boolean } {
  const seen = new Set<string>();
  /** Rachats recus mais pas encore traites : ils comptent comme connus pour le balayage des rachats en attente. */
  const queued = new Set<string>();
  let tail: Promise<void> = Promise.resolve();

  /** Retient un identifiant ; oublie le plus ancien au-dela de la limite. */
  function remember(id: string): void {
    seen.add(id);
    if (seen.size > REMEMBERED) {
      const oldest = seen.values().next().value;
      if (oldest !== undefined) seen.delete(oldest);
    }
  }

  /** Cloture le rachat ; rend vrai si Twitch l'a accepte. */
  async function settle(redemption: Redemption, outcome: 'refund' | 'fulfil'): Promise<boolean> {
    try {
      await deps.settle(redemption, outcome);
      return true;
    } catch {
      return false;
    }
  }

  async function refund(redemption: Redemption, reason: RefundReason): Promise<void> {
    // Un remboursement refuse n'est PAS le meme cas qu'une cloture refusee apres
    // une couleur posee : ici rien n'a ete applique, et le viewer reste debite.
    deps.report((await settle(redemption, 'refund'))
      ? { redemption, outcome: 'refunded', reason }
      : { redemption, outcome: 'refund-failed', reason });
  }

  async function process(redemption: Redemption): Promise<void> {
    // Un rachat d'une recompense qui n'est pas au plugin est ignore SANS etre lu :
    // l'abonnement couvre toute la chaine, et le texte des autres ne nous regarde pas.
    const action = deps.actionFor(redemption.rewardId);
    if (action === undefined) return;
    if (seen.has(redemption.id)) return;
    remember(redemption.id);

    if (!deps.enabled()) return refund(redemption, 'paused');

    // Seule la saisie libre lit le texte du viewer ; les boutons l'ignorent.
    let color: Hsv | undefined;
    if (action.kind === 'free') {
      const read = parseViewerColor(redemption.userInput);
      if (!read.ok) return refund(redemption, read.reason);
      color = read.color;
    } else if (action.kind === 'color') {
      color = action.color;
    } else if (action.kind === 'surprise') {
      color = surpriseColor(deps.random ?? Math.random);
    }

    let applied = false;
    try {
      applied = action.kind === 'scenario'
        ? await deps.playScenario(action.scenarioId, redemption.rewardCost)
        : await deps.applyColor(color as Hsv);
    } catch {
      // Un plantage cote ampoules vaut une ampoule injoignable : le viewer est rembourse.
    }
    if (!applied) return refund(redemption, 'bulbs-unreachable');

    deps.report((await settle(redemption, 'fulfil'))
      ? { redemption, outcome: 'applied', action, ...(color ? { color } : {}) }
      : { redemption, outcome: 'unsettled' });
  }

  const handle = (redemption: Redemption): Promise<void> => {
    // File pleine : rembourser tout de suite, hors file. Seuls les rachats du
    // plugin comptent, et un rachat deja vu reste ignore.
    if (queued.size >= MAX_QUEUED && deps.actionFor(redemption.rewardId) !== undefined && !seen.has(redemption.id) && !queued.has(redemption.id)) {
      remember(redemption.id);
      return refund(redemption, 'busy').catch(() => undefined);
    }
    // `process` est enveloppe pour qu'une erreur imprevue (dans `report`, par
    // exemple) ne casse jamais la file : le rachat suivant doit passer.
    queued.add(redemption.id);
    tail = tail.then(() => process(redemption)).catch(() => undefined).finally(() => { queued.delete(redemption.id); });
    return tail;
  };
  return Object.assign(handle, { isKnown: (id: string) => seen.has(id) || queued.has(id) });
}

/** Rachat laisse en attente chez Twitch (voir helix.ts). */
export type PendingRedemption = { readonly id: string; readonly rewardId: string; readonly redeemedAt: number };

/**
 * Parmi les rachats restes en attente, ceux qu'on peut rembourser sans risque.
 *
 * Un rachat est tres recent s'il vient d'arriver : le gestionnaire est peut-etre
 * en train de l'appliquer, et le rembourser en parallele ferait payer une
 * couleur deja posee ou clore deux fois le meme rachat. On ne retient donc que
 * ceux plus anciens que `minAgeMs`, et jamais ceux que le gestionnaire connait.
 */
export function staleRedemptions<T extends PendingRedemption>(
  pending: readonly T[],
  now: number,
  minAgeMs: number,
  isKnown: (id: string) => boolean = () => false,
): T[] {
  return pending.filter((p) => now - p.redeemedAt >= minAgeMs && !isKnown(p.id));
}
