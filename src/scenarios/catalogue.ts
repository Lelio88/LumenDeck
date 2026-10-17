/**
 * Catalogue des scenarios lumineux.
 *
 * Ce que fait ce module : decrire, en donnees pures, ce qu'une ou deux ampoules
 * doivent faire au fil du temps. Un scenario est une suite d'IMAGES, chacune
 * tenue un certain temps : « rouge a gauche, bleu a droite, pendant 320 ms ».
 *
 * Choix non evident, et raison d'etre du module : un scenario ne connait ni
 * Tuya, ni le reservoir de connexions, ni Stream Deck. Il transforme un numero
 * de pas en une image, et rien d'autre. C'est ce qui permet de verifier un
 * gyrophare ou une bougie sans allumer quoi que ce soit, et d'en ajouter un
 * sans toucher au moteur.
 *
 * Invariants a preserver :
 *   - `frame(step)` ne depend QUE de `step` (le tirage aleatoire des scenarios
 *     erratiques est assume et documente sur chacun) ;
 *   - aucune duree annoncee n'est inferieure a MIN_HOLD_MS ; le moteur borne de
 *     toute facon, mais un scenario qui demande 20 ms mentirait sur son rendu ;
 *   - un scenario a deux roles doit rester regardable avec UNE seule ampoule :
 *     le moteur n'applique alors que le premier role ;
 *   - `group(step, count)` rend EXACTEMENT `count` consignes, une par lampe,
 *     dans l'ordre choisi par l'utilisateur : c'est le sens dans lequel la
 *     lumiere se deplace.
 *
 * JOUER ENSEMBLE. Chaque scenario a deux ecritures. `frame` est ce que fait UNE
 * lampe (ou deux roles) ; plusieurs lampes le jouent alors en parallele, chacune
 * dans son coin. `group` ecrit le scenario POUR la piece entiere : la lumiere
 * passe de lampe en lampe (chenillard, vague, rotation), les teintes s'etalent,
 * les eclairs frappent une lampe a la fois. `frameFor` choisit selon la case
 * « les ampoules jouent ensemble » ; sans elle, rien ne change.
 *
 * Usage canonique :
 *   const scenario = byId('gyrophare');
 *   const image = scenario.frame(0);
 */
import type { Hsv } from '../driver/types.js';

/**
 * Duree minimale d'une image, en millisecondes.
 *
 * Deux raisons, aucune cosmetique. D'abord la sante : un clignotement au-dela
 * de 3 Hz peut declencher une crise chez une personne photosensible, et 250 ms
 * par image plafonne l'alternance a 2 Hz. Ensuite le materiel : chaque image
 * est un aller-retour reseau vers l'ampoule, qui finit par refuser les
 * commandes si on la sature.
 */
export const MIN_HOLD_MS = 250;

/** Ce qu'une ampoule doit faire pendant une image. Les champs absents sont laisses tels quels. */
export type Cue = {
  /** Allumer ou eteindre. Absent, l'allumage n'est pas touche. */
  readonly on?: boolean;
  /** Couleur a appliquer. Implique d'allumer. */
  readonly color?: Hsv;
  /** Intensite 1-100. Sans couleur, conserve la teinte courante. */
  readonly brightness?: number;
};

/** Une image du scenario : ce que fait chaque role, et combien de temps elle tient. */
export type Frame = {
  /** Une consigne par role. L'index 0 est le role principal. */
  readonly cues: readonly Cue[];
  /** Duree d'affichage en millisecondes, bornee a MIN_HOLD_MS par le moteur. */
  readonly holdMs: number;
};

export type Scenario = {
  /**
   * Identifiant stable, memorise dans les reglages de la touche.
   *
   * Sert AUSSI de cle de traduction : le nom et la description vivent dans les
   * dictionnaires, sous `scenario.<id>.name` et `.description`. Un catalogue qui
   * porterait ses libelles devrait consulter un dictionnaire, et cesserait
   * d'etre verifiable sans charger le plugin entier.
   *
   * Les identifiants restent en francais : ce sont des cles deja enregistrees
   * dans les reglages des utilisateurs, les renommer casserait leurs touches.
   */
  readonly id: string;
  /** Nombre d'ampoules que le scenario sait exploiter. */
  readonly roles: 1 | 2;
  /** Rejoue indefiniment, ou s'arrete tout seul au bout de `steps` images. */
  readonly loops: boolean;
  /** Nombre d'images avant arret. Obligatoire quand `loops` est faux. */
  readonly steps?: number;
  /** Produit l'image numero `step`, en comptant depuis zero. */
  frame(step: number): Frame;
  /** Produit l'image numero `step` pour `count` lampes qui jouent ENSEMBLE (count >= 2). */
  group(step: number, count: number): Frame;
};

const RED: Hsv = { h: 0, s: 100, v: 100 };
const BLUE: Hsv = { h: 225, s: 100, v: 100 };
const FLASH: Hsv = { h: 210, s: 8, v: 100 };
const NIGHT: Hsv = { h: 225, s: 60, v: 12 };

/** Entier aleatoire dans [min, max]. */
const between = (min: number, max: number) => min + Math.round(Math.random() * (max - min));

/** Une consigne par lampe, de 0 a count - 1. */
const each = <T>(count: number, cue: (index: number) => T): T[] => Array.from({ length: count }, (_, index) => cue(index));

/** Intensite de la respiration a une phase donnee du cycle de 12 images. */
const breath = (phase: number): number => {
  const p = ((phase % 12) + 12) % 12;
  const climb = p < 6 ? p : 11 - p;
  return 15 + Math.round((climb / 5) * 85);
};

/** Une flamme : teinte et intensite dans une plage etroite, tirees au hasard. */
const flame = (): Hsv => ({ h: between(24, 38), s: between(70, 90), v: between(45, 90) });

/** Image de l'orage : un eclair sur deux periodes premieres entre elles (7 et 11). */
const isFlash = (step: number): boolean => step % 7 === 3 || step % 11 === 5;

/** Couleur du lever de soleil a l'avancement t (0 a 1). */
const dawn = (t: number): Hsv => ({ h: 12 + Math.round(t * 28), s: Math.round(95 - t * 55), v: 5 + Math.round(t * 95) });

/** Retard d'une lampe sur la precedente au lever du soleil, en fraction de la duree. */
const SUNRISE_LAG = 0.15;

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

export const SCENARIOS: readonly Scenario[] = [
  {
    id: 'clignotement',
    roles: 1,
    loops: true,
    frame: (step) => ({ cues: [{ on: step % 2 === 0 }], holdMs: 400 }),
    // Chenillard : une seule lampe allumee, qui passe de l'une a l'autre.
    group: (step, count) => ({ cues: each(count, (i) => ({ on: i === step % count })), holdMs: 400 }),
  },
  {
    id: 'gyrophare',
    roles: 2,
    loops: true,
    // Les deux roles sont TOUJOURS en opposition : avec deux ampoules on obtient
    // le va-et-vient d'un gyrophare, et avec une seule le moteur ne retient que
    // le premier role, qui alterne donc rouge et bleu a lui tout seul.
    frame: (step) => ({
      cues: step % 2 === 0
        ? [{ on: true, color: RED }, { on: true, color: BLUE }]
        : [{ on: true, color: BLUE }, { on: true, color: RED }],
      holdMs: 320,
    }),
    // Le rouge fait le tour de TOUTES les lampes ; les autres sont bleues.
    group: (step, count) => ({
      cues: each(count, (i) => ({ on: true, color: i === step % count ? RED : BLUE })),
      holdMs: 320,
    }),
  },
  {
    id: 'respiration',
    roles: 1,
    loops: true,
    // On ne touche QUE l'intensite : la teinte reste celle que l'utilisateur
    // avait choisie, ce qui rend le scenario utilisable sur un blanc comme sur
    // une couleur sans le denaturer.
    frame: (step) => ({ cues: [{ on: true, brightness: breath(step) }], holdMs: 320 }),
    // Une vague : chaque lampe a son retard, reparti sur le cycle.
    group: (step, count) => ({
      cues: each(count, (i) => ({ on: true, brightness: breath(step - Math.round((i * 12) / count)) })),
      holdMs: 320,
    }),
  },
  {
    id: 'bougie',
    roles: 1,
    loops: true,
    // Aleatoire ASSUME : une bougie reguliere ne ressemble a rien. Teinte et
    // intensite varient dans une plage etroite — c'est l'irregularite des
    // DUREES qui fait l'essentiel de l'illusion.
    frame: () => ({ cues: [{ on: true, color: flame() }], holdMs: between(260, 480) }),
    // Chaque flamme est tiree a part : elles vacillent chacune a leur rythme.
    group: (_step, count) => ({ cues: each(count, () => ({ on: true, color: flame() })), holdMs: between(260, 480) }),
  },
  {
    id: 'orage',
    roles: 1,
    loops: true,
    // Deux periodes premieres entre elles (7 et 11) suffisent a produire des
    // eclairs qui ne retombent jamais sur le meme rythme, sans tirage aleatoire
    // et donc sans rendre le scenario intestable.
    frame: (step) => isFlash(step)
      ? { cues: [{ on: true, color: FLASH }], holdMs: 260 }
      : { cues: [{ on: true, color: NIGHT }], holdMs: 900 },
    // L'eclair de la periode 7 frappe UNE lampe, qui change a chaque fois ; celui
    // de la periode 11, plus rare, illumine toute la piece.
    group: (step, count) => {
      if (!isFlash(step)) return { cues: each(count, () => ({ on: true, color: NIGHT })), holdMs: 900 };
      const struck = step % 11 === 5 ? -1 : Math.floor(step / 7) % count;
      return { cues: each(count, (i) => ({ on: true, color: struck === -1 || i === struck ? FLASH : NIGHT })), holdMs: 260 };
    },
  },
  {
    id: 'arc-en-ciel',
    roles: 1,
    loops: true,
    frame: (step) => ({
      cues: [{ on: true, color: { h: (step * 12) % 360, s: 95, v: 90 } }],
      holdMs: 380,
    }),
    // Les teintes sont reparties sur le cercle : l'arc-en-ciel s'etale dans la piece.
    group: (step, count) => ({
      cues: each(count, (i) => ({ on: true, color: { h: (step * 12 + Math.round((i * 360) / count)) % 360, s: 95, v: 90 } })),
      holdMs: 380,
    }),
  },
  {
    id: 'alerte',
    roles: 1,
    loops: false,
    steps: 6,
    frame: (step) => step % 2 === 0
      ? { cues: [{ on: true, color: RED }], holdMs: 280 }
      : { cues: [{ on: false }], holdMs: 260 },
    // Les lampes voisines alternent : paires et impaires.
    group: (step, count) => ({
      cues: each(count, (i) => ((step + i) % 2 === 0 ? { on: true, color: RED } : { on: false })),
      holdMs: step % 2 === 0 ? 280 : 260,
    }),
  },
  {
    id: 'lever-de-soleil',
    roles: 1,
    loops: false,
    steps: 60,
    // Une seule rampe continue : la teinte passe de l'ambre profond au blanc
    // chaud pendant que l'intensite monte de 5 a 100. Les trois grandeurs
    // avancent ensemble, sinon on obtient un jaune plat qui s'eclaire.
    frame: (step) => ({ cues: [{ on: true, color: dawn(Math.min(1, step / 59)) }], holdMs: 5000 }),
    // Chaque lampe se leve un peu apres la precedente. La rampe est acceleree
    // d'autant, pour que la DERNIERE atteigne elle aussi le plein jour a la fin.
    group: (step, count) => ({
      cues: each(count, (i) => ({ on: true, color: dawn(clamp01((step / 59) * (1 + SUNRISE_LAG * (count - 1)) - i * SUNRISE_LAG)) })),
      holdMs: 5000,
    }),
  },
];

/**
 * L'image a jouer, selon que les lampes jouent ensemble ou chacune dans son coin.
 *
 * Seul point d'entree du moteur. Avec une seule lampe, « ensemble » n'a pas de
 * sens : on retombe sur le scenario d'origine, qui sait deja tenir sur une lampe.
 */
export function frameFor(scenario: Scenario, step: number, count: number, together: boolean): Frame {
  return together && count >= 2 ? scenario.group(step, count) : scenario.frame(step);
}

/** Le scenario portant cet identifiant, ou undefined. */
export function byId(id: string | undefined): Scenario | undefined {
  return id ? SCENARIOS.find((s) => s.id === id) : undefined;
}
