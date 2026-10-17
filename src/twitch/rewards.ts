/**
 * Catalogue des recompenses de points de chaine que LumenDeck propose.
 *
 * Ce que fait ce module : traduire les choix du panneau (couleurs cochees,
 * couleur surprise, saisie libre, scenarios) en recompenses a creer chez Twitch,
 * et chaque recompense en action sur les lampes.
 *
 * Choix non evidents :
 *
 *   - Une recompense par choix, sans rien a ecrire. Twitch n'a pas de selecteur
 *     de couleur : un viewer ne peut que cliquer un bouton, ou taper un texte.
 *     Chaque couleur de la palette et chaque scenario est donc SON bouton ; seule
 *     la « saisie libre » demande d'ecrire.
 *
 *   - Une recompense est identifiee par une CLE stable (`color:rouge`,
 *     `scenario:orage`, `free`, `surprise`), jamais par son titre : le titre
 *     suit la langue de Stream Deck et le streamer peut le changer chez Twitch.
 *
 *   - La duree d'un scenario suit le PRIX paye (`secondes pour 100 points`),
 *     bornee : le streamer change le prix dans son tableau de bord Twitch et la
 *     duree suit, sans repasser par le panneau. Le prix vient du rachat lui-meme.
 *
 *   - Tout reglage venu du panneau est NORMALISE : c'est une page web, et une
 *     valeur aberrante creerait des recompenses fantomes ou une animation d'une
 *     heure payee par un viewer.
 *
 * Invariant : n'importe rien d'autre que des types ; les titres passent par une
 * fonction de traduction injectee. Se teste sans SDK ni compte Twitch.
 */
import type { Hsv } from '../driver/types.ts';

/** Une couleur proposee aux viewers. L'identifiant sert de cle de traduction et de recompense. */
export type PaletteColor = { readonly id: string; readonly color: Hsv };

export const PALETTE: readonly PaletteColor[] = [
  { id: 'rouge', color: { h: 0, s: 100, v: 100 } },
  { id: 'orange', color: { h: 30, s: 100, v: 100 } },
  { id: 'jaune', color: { h: 55, s: 100, v: 100 } },
  { id: 'vert', color: { h: 120, s: 100, v: 100 } },
  { id: 'cyan', color: { h: 185, s: 100, v: 100 } },
  { id: 'bleu', color: { h: 230, s: 100, v: 100 } },
  { id: 'violet', color: { h: 275, s: 100, v: 100 } },
  { id: 'rose', color: { h: 330, s: 60, v: 100 } },
  { id: 'blanc', color: { h: 0, s: 0, v: 100 } },
];

/** Ce que le streamer a choisi dans le panneau de la touche Twitch. */
export type TwitchConfig = {
  readonly colors: readonly string[];
  readonly surprise: boolean;
  readonly freeText: boolean;
  readonly scenarios: readonly string[];
  /** Secondes de scenario pour 100 points depenses. */
  readonly secondsPer100: number;
  /** Duree maximale d'un scenario, en secondes. */
  readonly maxSeconds: number;
  /** Les lampes jouent la version de groupe des scenarios. */
  readonly together: boolean;
};

export const DEFAULT_CONFIG: TwitchConfig = {
  colors: ['rouge', 'vert', 'bleu', 'violet', 'rose'],
  surprise: true,
  freeText: true,
  scenarios: ['gyrophare', 'respiration', 'bougie', 'orage', 'arc-en-ciel'],
  secondsPer100: 10,
  maxSeconds: 60,
  together: true,
};

const RATE_BOUNDS = [1, 60] as const;
const MAX_BOUNDS = [5, 300] as const;
/** En dessous, l'effet passe inapercu a l'ecran : le viewer aurait paye pour rien. */
const MIN_SCENARIO_SECONDS = 5;

/** Prix par defaut a la creation ; le streamer les change ensuite chez Twitch. */
const COST = { free: 200, color: 100, surprise: 100, scenario: 300 } as const;
const COOLDOWN_SECONDS = 30;

const clamp = (n: number, [lo, hi]: readonly [number, number]) => Math.min(hi, Math.max(lo, n));

/** Garde les identifiants connus, dans l'ordre, sans doublon. */
function known(value: unknown, allowed: readonly string[]): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return [...new Set(value.filter((v): v is string => typeof v === 'string' && allowed.includes(v)))];
}

const bool = (value: unknown, fallback: boolean) => (typeof value === 'boolean' ? value : fallback);
const num = (value: unknown, fallback: number, bounds: readonly [number, number]) =>
  (typeof value === 'number' && Number.isFinite(value) ? clamp(Math.round(value), bounds) : fallback);

/** Reglages du panneau, nettoyes. `scenarioIds` : les scenarios du catalogue. */
export function normalizeConfig(raw: unknown, scenarioIds: readonly string[]): TwitchConfig {
  const r = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  return {
    colors: known(r.colors, PALETTE.map((c) => c.id)) ?? DEFAULT_CONFIG.colors,
    surprise: bool(r.surprise, DEFAULT_CONFIG.surprise),
    freeText: bool(r.freeText, DEFAULT_CONFIG.freeText),
    scenarios: known(r.scenarios, scenarioIds) ?? DEFAULT_CONFIG.scenarios,
    secondsPer100: num(r.secondsPer100, DEFAULT_CONFIG.secondsPer100, RATE_BOUNDS),
    maxSeconds: num(r.maxSeconds, DEFAULT_CONFIG.maxSeconds, MAX_BOUNDS),
    together: bool(r.together, DEFAULT_CONFIG.together),
  };
}

/** Une recompense a faire exister chez Twitch. */
export type RewardSpec = {
  readonly key: string;
  readonly title: string;
  readonly prompt: string;
  readonly cost: number;
  readonly cooldownSeconds: number;
  /** Seule la saisie libre demande au viewer d'ecrire. */
  readonly userInput: boolean;
};

/** Les recompenses que la configuration demande. `t` traduit une cle de dictionnaire. */
export function wantedRewards(config: TwitchConfig, t: (key: string) => string): RewardSpec[] {
  const spec = (key: string, title: string, prompt: string, cost: number, userInput = false): RewardSpec =>
    ({ key, title, prompt, cost, cooldownSeconds: COOLDOWN_SECONDS, userInput });
  return [
    ...(config.freeText ? [spec('free', t('twitch.reward.colorTitle'), t('twitch.reward.colorPrompt'), COST.free, true)] : []),
    ...config.colors.map((id) => spec('color:' + id, t('twitch.reward.palette.' + id), t('twitch.reward.palettePrompt'), COST.color)),
    ...(config.surprise ? [spec('surprise', t('twitch.reward.surprise'), t('twitch.reward.surprisePrompt'), COST.surprise)] : []),
    ...config.scenarios.map((id) => spec(
      'scenario:' + id, t('twitch.reward.scenarioPrefix') + t('scenario.' + id + '.name'), t('twitch.reward.scenarioPrompt'), COST.scenario,
    )),
  ];
}

/** Ce qu'un rachat declenche. */
export type RewardAction =
  | { readonly kind: 'free' }
  | { readonly kind: 'color'; readonly color: Hsv }
  | { readonly kind: 'surprise' }
  | { readonly kind: 'scenario'; readonly scenarioId: string };

/** L'action d'une cle de recompense, ou undefined si la cle n'est pas (ou plus) connue. */
export function actionFor(key: string): RewardAction | undefined {
  if (key === 'free') return { kind: 'free' };
  if (key === 'surprise') return { kind: 'surprise' };
  if (key.startsWith('scenario:')) return { kind: 'scenario', scenarioId: key.slice('scenario:'.length) };
  if (key.startsWith('color:')) {
    const found = PALETTE.find((c) => c.id === key.slice('color:'.length));
    return found ? { kind: 'color', color: found.color } : undefined;
  }
  return undefined;
}

/** Une couleur vive tiree au hasard. `random` rend un nombre dans [0, 1), injecte pour les tests. */
export function surpriseColor(random: () => number): Hsv {
  return { h: Math.floor(random() * 360) % 360, s: 100, v: 100 };
}

/** Duree d'un scenario paye `cost` points, en millisecondes, entre 5 s et le plafond. */
export function scenarioDuration(cost: number, secondsPer100: number, maxSeconds: number): number {
  const seconds = (cost / 100) * secondsPer100;
  const bounded = Number.isFinite(seconds) ? Math.min(maxSeconds, Math.max(MIN_SCENARIO_SECONDS, seconds)) : MIN_SCENARIO_SECONDS;
  return Math.round(bounded * 1000);
}

/** Une recompense existante chez Twitch, du point de vue du plan. */
export type OwnReward = { readonly id: string; readonly title: string };

/** Ce que la synchronisation doit faire chez Twitch. */
export type RewardPlan = {
  /** Cle -> identifiant des recompenses a garder telles quelles. */
  readonly keep: Record<string, string>;
  readonly create: RewardSpec[];
  /** Recompenses du plugin qui ne sont plus voulues, avec la cle qu'elles servaient. */
  readonly remove: { readonly key: string; readonly id: string }[];
};

/**
 * Compare les recompenses voulues a celles qui existent, et dit quoi garder,
 * creer et supprimer.
 *
 * `own` : les recompenses gerables par le plugin (creees par lui) ; `current` :
 * la correspondance cle -> identifiant connue jusqu'ici.
 *
 * Choix non evidents :
 *   - une recompense du plugin retrouvee par son TITRE est reprise plutot que
 *     recreee : apres une reinstallation, la correspondance est perdue mais la
 *     recompense existe, et Twitch refuserait un second titre identique ;
 *   - on ne supprime QUE ce qui figure dans `current` : une recompense gerable
 *     mais inconnue vient peut-etre d'une autre installation, on n'y touche pas ;
 *   - une recompense ne sert jamais deux cles.
 */
export function planRewards(wanted: readonly RewardSpec[], own: readonly OwnReward[], current: Readonly<Record<string, string>>): RewardPlan {
  const ownIds = new Set(own.map((r) => r.id));
  const used = new Set<string>();
  const keep: Record<string, string> = {};
  const create: RewardSpec[] = [];

  for (const spec of wanted) {
    const known = current[spec.key];
    const found = known && ownIds.has(known) && !used.has(known)
      ? known
      : own.find((r) => r.title === spec.title && !used.has(r.id))?.id;
    if (found) {
      keep[spec.key] = found;
      used.add(found);
    } else {
      create.push(spec);
    }
  }

  const remove: { key: string; id: string }[] = [];
  for (const [key, id] of Object.entries(current)) {
    if (!ownIds.has(id) || used.has(id) || remove.some((r) => r.id === id)) continue;
    remove.push({ key, id });
  }
  return { keep, create, remove };
}
