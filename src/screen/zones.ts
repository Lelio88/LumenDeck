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
 *     traine d'une seconde apres une coupe de montage. L'ecart mesure decide :
 *     petit, on glisse ; grand, on rattrape.
 *
 *   - Un ecran noir TAMISE les lampes (`MIN_VALUE`) au lieu de les eteindre : un
 *     fondu au noir ou un ecran de chargement ne doit pas plonger la piece dans
 *     le noir complet, puis l'allumer en sursaut a la scene suivante.
 *
 *   - La saturation est renforcee : la moyenne d'une scene donne presque
 *     toujours des couleurs ternes, et une ampoule grisatre n'a pas l'effet
 *     recherche. Le gain est FIXE, a dessein (pas de reglage dans cette version).
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

/** Lissage : part de l'ecart rattrapee a chaque image, entre une scene stable et une coupe franche. */
const ALPHA_STEADY = 0.3;
const ALPHA_CUT = 0.85;
/** Ecart (0-1) a partir duquel on considere qu'il s'agit d'une coupe. */
const CUT_THRESHOLD = 0.35;

/** Ecarts en dessous desquels on n'embete pas la lampe : teinte en degres, le reste en %. */
const MIN_HUE_STEP = 3;
const MIN_PERCENT_STEP = 3;

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

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
    v: Math.round(clamp(sample.v * VALUE_GAIN, MIN_VALUE, 100)),
  };
}

/** Lisseur d'une zone : garde l'etat precedent, rend la mesure adoucie. */
export type Smoother = { push(sample: ZoneSample): ZoneSample };

export function createSmoother(): Smoother {
  let state: { rgb: [number, number, number]; v: number } | null = null;

  return {
    push(sample) {
      if (!state) {
        state = { rgb: [...sample.rgb], v: sample.v };
      } else {
        const gap = Math.max(
          (Math.abs(sample.rgb[0] - state.rgb[0]) + Math.abs(sample.rgb[1] - state.rgb[1]) + Math.abs(sample.rgb[2] - state.rgb[2])) / 765,
          Math.abs(sample.v - state.v) / 100,
        );
        const alpha = gap >= CUT_THRESHOLD ? ALPHA_CUT : ALPHA_STEADY + (ALPHA_CUT - ALPHA_STEADY) * (gap / CUT_THRESHOLD);
        state = {
          rgb: [
            state.rgb[0] + (sample.rgb[0] - state.rgb[0]) * alpha,
            state.rgb[1] + (sample.rgb[1] - state.rgb[1]) * alpha,
            state.rgb[2] + (sample.rgb[2] - state.rgb[2]) * alpha,
          ],
          v: state.v + (sample.v - state.v) * alpha,
        };
      }
      return { rgb: [Math.round(state.rgb[0]), Math.round(state.rgb[1]), Math.round(state.rgb[2])], v: state.v };
    },
  };
}

/** Vrai si `next` vaut la peine d'un aller-retour reseau par rapport a ce que la lampe montre deja. */
export function differs(previous: Hsv | null, next: Hsv): boolean {
  if (!previous) return true;
  const hueGap = Math.abs(previous.h - next.h);
  const circular = Math.min(hueGap, 360 - hueGap);
  return circular >= MIN_HUE_STEP
    || Math.abs(previous.s - next.s) >= MIN_PERCENT_STEP
    || Math.abs(previous.v - next.v) >= MIN_PERCENT_STEP;
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
