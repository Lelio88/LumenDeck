/**
 * Lecture d'une couleur tapee par un viewer Twitch.
 *
 * Ce que fait ce module : transformer le texte libre d'un rachat de points de
 * chaine en couleur pour les ampoules, ou dire POURQUOI il est refuse (le
 * rachat sera alors rembourse).
 *
 * Choix non evidents :
 *
 *   - Le texte vient d'un inconnu, donc la lecture est STRICTE : un mot, rien
 *     d'autre. « rouge vif » est refuse plutot que reduit a « rouge ». Une
 *     couleur devinee fait payer au viewer une chose qu'il n'a pas demandee.
 *
 *   - L'hexadecimal exige le diese. « facade » est aussi un mot, et sans le
 *     signe on ne saurait pas lequel des deux le viewer a voulu.
 *
 *   - Les couleurs quasi noires sont refusees (`too-dark`). Pour une ampoule,
 *     un noir est un interrupteur : sans cette regle, n'importe quel viewer
 *     eteindrait la piece pour le prix d'un rachat.
 *
 *   - La longueur est controlee AVANT toute autre analyse : on ne passe pas une
 *     chaine demesuree dans des expressions regulieres.
 *
 * Invariant : la fonction ne leve jamais et n'a aucun effet de bord. Elle est
 * pure pour se tester sans Stream Deck, ampoule ni compte Twitch.
 *
 * Usage canonique :
 *   const read = parseViewerColor(event.user_input);
 *   if (!read.ok) return refund(event, read.reason);
 *   await bulb.setColor(read.color);
 */
import { hexToHsv } from '../color-format.ts';
import type { Hsv } from '../driver/types.ts';

/** Raison d'un refus, pour choisir quoi dire au viewer et au journal. */
export type RejectReason = 'empty' | 'too-long' | 'too-dark' | 'unknown';

export type ParsedColor =
  | { readonly ok: true; readonly color: Hsv }
  | { readonly ok: false; readonly reason: RejectReason };

/** Au-dela, ce n'est pas une couleur : « bleu ciel tirant sur le gris »... */
const MAX_LENGTH = 40;

/** Valeur minimale (0-100) pour que la couleur se voie : en dessous, c'est une extinction. */
const MIN_VALUE = 20;

/**
 * Les noms compris : francais, anglais, allemand, espagnol, italien.
 *
 * Toute langue dans laquelle la recompense peut etre POSTEE doit voir ses
 * propres exemples acceptes : le texte de la recompense suit la langue de
 * Stream Deck, et un exemple refuse ferait rembourser chaque viewer qui le suit
 * (un test relit les textes reels pour le garantir). Des TSV pleins, sauf mention.
 */
const RED: Hsv = { h: 0, s: 100, v: 100 };
const ORANGE: Hsv = { h: 30, s: 100, v: 100 };
const YELLOW: Hsv = { h: 60, s: 100, v: 100 };
const GREEN: Hsv = { h: 120, s: 100, v: 100 };
const CYAN: Hsv = { h: 180, s: 100, v: 100 };
const BLUE: Hsv = { h: 240, s: 100, v: 100 };
const VIOLET: Hsv = { h: 270, s: 100, v: 100 };
const MAGENTA: Hsv = { h: 300, s: 100, v: 100 };
const PINK: Hsv = { h: 330, s: 60, v: 100 };
const WHITE: Hsv = { h: 0, s: 0, v: 100 };
// Refuse avec sa vraie raison (`too-dark`), pas avec un « inconnu ».
const BLACK: Hsv = { h: 0, s: 0, v: 0 };

const NAMED: Readonly<Record<string, Hsv>> = {
  // francais
  rouge: RED, orange: ORANGE, jaune: YELLOW, vert: GREEN, cyan: CYAN, bleu: BLUE, violet: VIOLET,
  magenta: MAGENTA, rose: PINK, blanc: WHITE, noir: BLACK,
  turquoise: { h: 175, s: 100, v: 90 },
  // anglais
  red: RED, yellow: YELLOW, green: GREEN, blue: BLUE, purple: VIOLET, pink: PINK, white: WHITE, black: BLACK,
  // allemand
  rot: RED, gelb: YELLOW, gruen: GREEN, 'grün': GREEN, blau: BLUE, lila: VIOLET, rosa: PINK,
  weiss: WHITE, 'weiß': WHITE, schwarz: BLACK,
  // espagnol
  rojo: RED, naranja: ORANGE, amarillo: YELLOW, verde: GREEN, azul: BLUE, morado: VIOLET,
  blanco: WHITE, negro: BLACK,
  // italien
  rosso: RED, arancione: ORANGE, giallo: YELLOW, blu: BLUE, viola: VIOLET, bianco: WHITE, nero: BLACK,
};

/** Les noms de la table, pour que la doc et les tests les enumerent. */
export const COLOR_NAMES: readonly string[] = Object.keys(NAMED);

/** Un `#` suivi de 3 ou 6 chiffres hexadecimaux, et RIEN d'autre. */
const STRICT_HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

const accept = (color: Hsv): ParsedColor =>
  color.v < MIN_VALUE ? { ok: false, reason: 'too-dark' } : { ok: true, color };

/** Lit le texte d'un rachat. Ne leve jamais. */
export function parseViewerColor(input: string | undefined): ParsedColor {
  if (input === undefined) return { ok: false, reason: 'empty' };
  if (input.length > MAX_LENGTH) return { ok: false, reason: 'too-long' };

  const text = input.trim().toLowerCase();
  if (text.length === 0) return { ok: false, reason: 'empty' };

  const named = Object.hasOwn(NAMED, text) ? NAMED[text] : undefined;
  if (named) return accept(named);

  if (STRICT_HEX.test(text)) {
    const color = hexToHsv(text);
    if (color) return accept(color);
  }
  return { ok: false, reason: 'unknown' };
}
