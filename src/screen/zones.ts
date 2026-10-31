/**
 * Mise en forme de la couleur de l'ecran pour une ampoule : lecture des lignes
 * du capteur, lissage, saturation, repartition des lampes par zone.
 *
 * Ce que fait ce module : transformer ce que mesure le capteur (une couleur
 * brute par zone d'ecran) en la couleur qu'on envoie vraiment a chaque lampe.
 * C'est ici que vit le GOUT du suivi d'ecran ; le capteur Rust, lui, ne fait
 * que mesurer vite.
 *
 * Choix non evidents :
 *
 *   - Le lissage porte sur le RVB, pas sur la teinte : une teinte tourne en
 *     rond (359 -> 1) et lisser ses degres ferait traverser tout l'arc-en-ciel
 *     a une scene qui passe du rouge au rouge orange.
 *
 *   - Le lissage est ADAPTATIF. Un coefficient fixe est toujours un mauvais
 *     compromis : assez doux pour ne pas scintiller sur une scene stable, il
 *     traine apres une coupe de montage. L'ecart mesure decide : petit, on
 *     glisse ; grand, on rattrape — mais jamais d'un coup : meme une coupe
 *     franche se fond en quelques dixiemes de seconde, car une lampe qui saute
 *     d'une couleur a l'autre est ce qu'on remarque le plus. A 30 mesures par
 *     seconde, une scene stable se fond en ~0,6 s, une coupe en ~0,2 s.
 *
 *   - La luminosite est amortie sur DEUX echelles de temps (moyenne lente + part du
 *     mouvement rapide), pas la couleur : ce sont les variations de luminosite que
 *     l'oeil trouve brusques dans une piece, alors qu'une couleur qui change vite
 *     est justement l'effet recherche.
 *
 *   - Un ecran noir TAMISE les lampes (`MIN_VALUE`) au lieu de les eteindre : un
 *     fondu au noir ou un ecran de chargement ne doit pas plonger la piece dans
 *     le noir complet, puis l'allumer en sursaut a la scene suivante.
 *
 *   - La saturation est renforcee : la moyenne d'une scene donne presque
 *     toujours des couleurs ternes, et une ampoule grisatre n'a pas l'effet
 *     recherche. Le gain est FIXE, a dessein (pas de reglage dans cette version).
 *
 *   - Le lissage ne suffit pas : il adoucit l'ecart avec la cible, mais n'impose
 *     aucune VITESSE MAXIMALE. Les ampoules Tuya n'ont pas de fondu materiel (a
 *     la difference de Philips Hue, ou chaque ordre porte un temps de transition) :
 *     une couleur envoyee s'applique d'un coup. `stepToward` borne donc ce que la
 *     lampe parcourt a chaque envoi. La luminosite avance par pas EGAUX A L'OEIL
 *     (`lightness`), pas par pas egaux en pourcentage : l'oeil juge un rapport, et
 *     passer de 3 % a 11 % est un bond (la lampe est presque quatre fois plus
 *     claire) la ou 80 % a 88 % ne se voit pas. Un pas lineaire est donc trop gros
 *     dans le noir — c'est la que la « marche » se voyait — et inutilement fin
 *     dans le clair.
 *
 * Invariants : ces fonctions sont PURES et ne dependent que de leurs arguments ;
 * une ligne du capteur douteuse est ecartee (`null`), jamais interpretee ; la
 * valeur rendue par `gradeZone` est toujours dans les bornes que le pilote accepte.
 *
 * Usage canonique :
 *   const event = parseCaptureLine(line);
 *   if (event?.kind === 'frame') {
 *     const smooth = smoothers.map((s, i) => s.push(event.zones[i]));
 *     const color = gradeZone(smooth[0]);
 *   }
 */
import { hexToHsv } from '../color-format.ts';
import type { Hsv } from '../driver/types.js';

/** Couleur brute mesuree sur une zone : RVB 0-255 pondere par la saturation, et luminosite moyenne 0-100. */
export type ZoneSample = { readonly rgb: readonly [number, number, number]; readonly v: number };

/** Ce que le capteur dit sur sa sortie standard. */
export type CaptureEvent =
  | { readonly kind: 'frame'; readonly zones: readonly ZoneSample[] }
  | { readonly kind: 'status'; readonly status: 'ready' | 'lost' };

/** Nombre maximal de zones qu'une ligne peut porter. */
export const MAX_ZONES = 4;
/** Luminosite plancher d'une lampe suivant l'ecran, en %. Jamais 0 : la lampe reste allumee. */
export const MIN_VALUE = 3;
/** Renfort de saturation applique a la moyenne de la scene. */
const SATURATION_GAIN = 1.35;
/** Renfort de luminosite : une scene moyenne ne doit pas laisser la piece sombre. */
const VALUE_GAIN = 1.15;

/**
 * Mesures demandees au capteur, par seconde. Le lissage est regle en SECONDES (constantes
 * de temps), pas en coefficient par image : changer ce nombre ne doit pas changer le
 * caractere du rendu, seulement sa finesse.
 */
export const CAPTURE_FPS = 30;

/** Coefficient par image qui donne une constante de temps de `tauSeconds` a `fps` images par seconde. */
const alphaFor = (tauSeconds: number, fps: number): number => 1 - Math.exp(-1 / (fps * tauSeconds));

/** Lissage, en secondes : une scene stable se fond en ~0,5 s, une coupe franche en ~0,13 s. */
const TAU_STEADY_S = 0.52;
const TAU_CUT_S = 0.13;
/** Ecart (0-1) a partir duquel on considere qu'il s'agit d'une coupe. */
const CUT_THRESHOLD = 0.5;

/**
 * Luminosite : deux echelles de temps. Une moyenne LENTE (~2 s) porte l'ambiance de la
 * scene ; le mouvement rapide autour d'elle n'est repris que pour `FAST_SHARE`. Une
 * explosion, un menu clair ou un sous-titre font ainsi a peine bouger la piece, alors
 * qu'une scene durablement plus claire finit par etre suivie en quelques secondes.
 * Seule la luminosite est ainsi amortie : la couleur reste vive.
 */
const TAU_SLOW_S = 2.2;
const FAST_SHARE = 0.35;

/**
 * Ecarts en dessous desquels on n'embete pas la lampe. Volontairement a la RESOLUTION de
 * l'ampoule (1 degre de teinte, 0,5 % de saturation, ~0,5 % de clarte percue) : un seuil
 * plus large retient les petites variations puis les envoie d'un coup, et c'est cette
 * marche, non la vitesse, que l'oeil voit. Relevé en conditions reelles avant ce reglage :
 * 15 images par seconde mais 3 a 8 ecritures seulement.
 */
const MIN_HUE_STEP = 1;
const MIN_SATURATION_STEP = 0.5;
/** Ecart de clarte percue (0-1) en dessous duquel un changement de luminosite ne se voit pas. */
const MIN_LIGHTNESS_STEP = 0.005;

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

/** Exposant de la courbe de perception de la luminosite (~gamma 2,2 des ecrans). */
const PERCEPTION_GAMMA = 2.2;
const round1 = (n: number): number => Math.round(n * 10) / 10;

/** Clarte percue (0-1) d'une luminosite en % : ce que l'oeil compare, plutot que le pourcentage brut. */
export const lightness = (percent: number): number => Math.pow(clamp(percent, 0, 100) / 100, 1 / PERCEPTION_GAMMA);
/** Luminosite en % d'une clarte percue (0-1). */
const fromLightness = (perceived: number): number => Math.pow(clamp(perceived, 0, 1), PERCEPTION_GAMMA) * 100;

const isChannel = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= 255;
const isPercent = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 100;

function parseZone(raw: unknown): ZoneSample | null {
  if (!Array.isArray(raw) || raw.length !== 4) return null;
  const [r, g, b, v] = raw as unknown[];
  if (!isChannel(r) || !isChannel(g) || !isChannel(b) || !isPercent(v)) return null;
  return { rgb: [r, g, b], v };
}

/**
 * Lit une ligne du capteur. Rend `null` pour tout ce qui n'est pas exactement
 * attendu : la sortie d'un processus externe est une frontiere, pas une confiance.
 */
export function parseCaptureLine(line: string): CaptureEvent | null {
  let data: unknown;
  try {
    data = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return null;
  const record = data as Record<string, unknown>;

  if (record.status === 'ready' || record.status === 'lost') return { kind: 'status', status: record.status };

  const raw = record.zones;
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_ZONES) return null;
  const zones: ZoneSample[] = [];
  for (const entry of raw) {
    const zone = parseZone(entry);
    if (!zone) return null;
    zones.push(zone);
  }
  return { kind: 'frame', zones };
}

const hex2 = (n: number): string => Math.round(n).toString(16).padStart(2, '0');

/** La couleur qu'on envoie a la lampe pour cette mesure : teinte de la scene, saturation avivee, luminosite suivie. */
export function gradeZone(sample: ZoneSample): Hsv {
  const [r, g, b] = sample.rgb;
  const base = hexToHsv('#' + hex2(r) + hex2(g) + hex2(b)) ?? { h: 0, s: 0, v: 0 };
  return {
    h: base.h,
    s: Math.round(clamp(base.s * SATURATION_GAIN, 0, 100)),
    v: round1(clamp(sample.v * VALUE_GAIN, MIN_VALUE, 100)),
  };
}

/**
 * Vrai pour un ECRAN noir (bande noire, fondu, ecran de veille), pas pour une scene seulement
 * sombre : le capteur rend exactement 0 quand aucun pixel n'est allume, et la luminosite
 * moyenne d'une scene sombre meme tres peu eclairee reste au-dessus de 1.
 */
export function isBlack(sample: ZoneSample): boolean {
  return sample.v <= 1 && Math.max(...sample.rgb) <= 8;
}

/** Lisseur d'une zone : garde l'etat precedent, rend la mesure adoucie. */
export type Smoother = { push(sample: ZoneSample): ZoneSample };

export function createSmoother(fps: number = CAPTURE_FPS): Smoother {
  const alphaSteady = alphaFor(TAU_STEADY_S, fps);
  const alphaCut = alphaFor(TAU_CUT_S, fps);
  const alphaSlow = alphaFor(TAU_SLOW_S, fps);
  let state: { rgb: [number, number, number]; v: number; slowV: number } | null = null;

  return {
    push(sample) {
      if (!state) {
        state = { rgb: [...sample.rgb], v: sample.v, slowV: sample.v };
      } else if (isBlack(sample)) {
        // Un ecran noir n'a pas de couleur : le RVB vaut 0, et lisser vers 0 ferait perdre la
        // teinte, donc virer la lampe au BLANC (saturation 0) en fin de fondu. On garde la
        // couleur d'avant le noir et on ne fait descendre que la luminosite.
        state = {
          rgb: state.rgb,
          v: state.v + (sample.v - state.v) * alphaSteady,
          slowV: state.slowV + (sample.v - state.slowV) * alphaSlow,
        };
      } else {
        const gap = Math.max(
          (Math.abs(sample.rgb[0] - state.rgb[0]) + Math.abs(sample.rgb[1] - state.rgb[1]) + Math.abs(sample.rgb[2] - state.rgb[2])) / 765,
          Math.abs(sample.v - state.v) / 100,
        );
        const alpha = gap >= CUT_THRESHOLD ? alphaCut : alphaSteady + (alphaCut - alphaSteady) * (gap / CUT_THRESHOLD);
        state = {
          rgb: [
            state.rgb[0] + (sample.rgb[0] - state.rgb[0]) * alpha,
            state.rgb[1] + (sample.rgb[1] - state.rgb[1]) * alpha,
            state.rgb[2] + (sample.rgb[2] - state.rgb[2]) * alpha,
          ],
          // La luminosite n'a PAS de rattrapage de coupe : un flash doit etre amorti, pas suivi.
          v: state.v + (sample.v - state.v) * alphaSteady,
          slowV: state.slowV + (sample.v - state.slowV) * alphaSlow,
        };
      }
      const v = state.slowV + (state.v - state.slowV) * FAST_SHARE;
      return { rgb: [Math.round(state.rgb[0]), Math.round(state.rgb[1]), Math.round(state.rgb[2])], v };
    },
  };
}

/**
 * VITESSES maximales d'une lampe : 160 degres de teinte par seconde, 96 points de saturation
 * par seconde, et 0,5 de CLARTE PERCUE par seconde (la moitie de l'echelle de perception,
 * quel que soit le niveau de depart). Un balayage complet de la luminosite prend ~2 s, un tour
 * de 120 degres de teinte ~0,8 s. Le pas d'un envoi est cette vitesse multipliee par le temps
 * REELLEMENT ecoule depuis le precedent : le rendu ne depend pas du rythme du reseau, qui varie.
 */
const MAX_HUE_RATE = 160;
const MAX_SATURATION_RATE = 96;
const MAX_LIGHTNESS_RATE = 0.5;
/**
 * Temps ecoule pris en compte, borne. Le maximum est ~UN envoi normal : une lampe restee
 * au repos (scene fixe) puis remise en mouvement doit repartir par un pas ordinaire, pas
 * par le « rattrapage » de tout le temps passe a ne rien faire, qui serait un saut.
 */
const MIN_ELAPSED_S = 0.005;
const MAX_ELAPSED_S = 0.2;
/** En dessous, la lampe est presque grise : sa teinte ne se voit pas et ne compte pas. */
const GREY_SATURATION = 10;

const towards = (from: number, to: number, max: number): number => from + clamp(to - from, -max, max);

/**
 * La couleur a envoyer a une lampe qui montre `current` quand l'ecran vise `target`, `elapsedSeconds`
 * apres le precedent envoi : un pas borne (vitesse maximale x temps) vers la cible, jamais au-dela. `null` (rien d'envoye encore) : la cible.
 *
 * La teinte prend le plus court chemin autour du cercle. Une lampe presque grise
 * saute directement a la teinte visee : sans couleur visible, la faire tourner
 * l'amenerait a travers des teintes parasites en meme temps que sa saturation monte.
 */
export function stepToward(current: Hsv | null, target: Hsv, elapsedSeconds: number): Hsv {
  if (!current) return target;
  const dt = clamp(elapsedSeconds, MIN_ELAPSED_S, MAX_ELAPSED_S);
  const maxHue = MAX_HUE_RATE * dt;
  const maxSaturation = MAX_SATURATION_RATE * dt;
  const maxLightness = MAX_LIGHTNESS_RATE * dt;
  const diff = ((target.h - current.h + 540) % 360) - 180;
  const h = current.s < GREY_SATURATION
    ? target.h
    : (current.h + clamp(diff, -maxHue, maxHue) + 360) % 360;
  const perceived = towards(lightness(current.v), lightness(target.v), maxLightness);
  return {
    h: Math.round(h),
    s: round1(towards(current.s, target.s, maxSaturation)),
    // Une decimale : le pilote ecrit la luminosite au dixieme de pour cent, et les marches du bas sont fines.
    v: round1(fromLightness(perceived)),
  };
}

/** Vrai si `next` vaut la peine d'un aller-retour reseau par rapport a ce que la lampe montre deja. */
export function differs(previous: Hsv | null, next: Hsv): boolean {
  if (!previous) return true;
  const hueGap = Math.abs(previous.h - next.h);
  const circular = Math.min(hueGap, 360 - hueGap);
  return circular >= MIN_HUE_STEP
    || Math.abs(previous.s - next.s) >= MIN_SATURATION_STEP
    || Math.abs(lightness(previous.v) - lightness(next.v)) >= MIN_LIGHTNESS_STEP;
}

/**
 * La zone d'ecran qui commande la lampe de rang `index` parmi `count`.
 *
 * L'ordre des ampoules est celui de la piece, de gauche a droite (comme pour le
 * sens d'un scenario de groupe) : la premiere moitie suit la zone de gauche, la
 * seconde celle de droite.
 */
export function zoneOfBulb(index: number, count: number, zones: number): number {
  if (zones <= 1 || count <= 1) return 0;
  return Math.min(zones - 1, Math.floor((index * zones) / count));
}
