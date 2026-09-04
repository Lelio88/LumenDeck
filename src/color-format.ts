/**
 * Conversions entre la notation hexadecimale de l'interface et le modele TSV
 * du pilote.
 *
 * Ce que fait ce module : traduire ce que le selecteur de couleur du panneau de
 * reglages produit (`#ff8800`) vers ce que le contrat LightDriver attend (teinte,
 * saturation, valeur), et l'inverse pour reafficher.
 *
 * Choix non evident : la conversion vit dans la couche PRESENTATION, pas dans le
 * pilote. L'hexadecimal est une convention d'interface web, imposee par le
 * composant `sdpi-color` ; le pilote, lui, raisonne en TSV parce que c'est ce que
 * parlent les ampoules. Mettre cette traduction dans le pilote reviendrait a lui
 * faire connaitre l'interface qui l'appelle.
 *
 * Invariant : l'aller-retour hex -> TSV -> hex doit etre stable a une unite pres
 * sur chaque composante. Les tests le verifient, parce qu'une erreur de facteur
 * ici produit une couleur plausible mais fausse, ce que l'oeil ne detecte pas.
 *
 * Usage canonique :
 *   await bulb.setColor(hexToHsv('#ff8800'));
 */
import type { Hsv } from './driver/types.js';

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/**
 * Convertit une couleur hexadecimale en TSV.
 *
 * Accepte les formes `#rgb`, `#rrggbb`, avec ou sans diese. Renvoie null plutot
 * que de deviner si la chaine est malformee : une couleur fausse silencieuse est
 * pire qu'une absence de couleur.
 */
export function hexToHsv(hex: string): Hsv | null {
  const raw = hex.trim().replace(/^#/, '');
  const full =
    raw.length === 3 ? raw.split('').map((c) => c + c).join('')
    : raw.length === 6 ? raw
    : null;
  if (full === null || !/^[0-9a-f]{6}$/i.test(full)) return null;

  const r = parseInt(full.slice(0, 2), 16) / 255;
  const g = parseInt(full.slice(2, 4), 16) / 255;
  const b = parseInt(full.slice(4, 6), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;

  let h = 0;
  if (delta !== 0) {
    if (max === r) h = 60 * (((g - b) / delta) % 6);
    else if (max === g) h = 60 * ((b - r) / delta + 2);
    else h = 60 * ((r - g) / delta + 4);
  }
  if (h < 0) h += 360;

  return {
    h: Math.round(h) % 360,
    s: Math.round((max === 0 ? 0 : delta / max) * 100),
    v: Math.round(max * 100),
  };
}

/** Convertit un TSV en couleur hexadecimale `#rrggbb`. */
export function hsvToHex({ h, s, v }: Hsv): string {
  const hh = ((h % 360) + 360) % 360;
  const ss = clamp(s, 0, 100) / 100;
  const vv = clamp(v, 0, 100) / 100;

  const c = vv * ss;
  const x = c * (1 - Math.abs(((hh / 60) % 2) - 1));
  const m = vv - c;

  const sector = Math.floor(hh / 60) % 6;
  const rgb: readonly [number, number, number] =
    sector === 0 ? [c, x, 0]
    : sector === 1 ? [x, c, 0]
    : sector === 2 ? [0, c, x]
    : sector === 3 ? [0, x, c]
    : sector === 4 ? [x, 0, c]
    : [c, 0, x];

  const byte = (n: number) => Math.round((n + m) * 255).toString(16).padStart(2, '0');
  return '#' + byte(rgb[0]) + byte(rgb[1]) + byte(rgb[2]);
}

/**
 * Fait tourner la teinte d'un certain nombre de degres, en preservant
 * saturation et valeur.
 *
 * Sert a la rotation de molette : tourner change la couleur sans toucher a
 * l'intensite percue, ce qui serait desagreable.
 */
export function rotateHue(color: Hsv, degrees: number): Hsv {
  return { ...color, h: (((color.h + degrees) % 360) + 360) % 360 };
}
