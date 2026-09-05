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
 *     le moteur n'applique alors que le premier role.
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
  /** Identifiant stable, memorise dans les reglages de la touche. */
  readonly id: string;
  /** Nom affiche dans la liste et sur la touche. */
  readonly name: string;
  /** Une phrase, affichee dans le panneau de reglages. */
  readonly description: string;
  /** Nombre d'ampoules que le scenario sait exploiter. */
  readonly roles: 1 | 2;
  /** Rejoue indefiniment, ou s'arrete tout seul au bout de `steps` images. */
  readonly loops: boolean;
  /** Nombre d'images avant arret. Obligatoire quand `loops` est faux. */
  readonly steps?: number;
  /** Produit l'image numero `step`, en comptant depuis zero. */
  frame(step: number): Frame;
};

const RED: Hsv = { h: 0, s: 100, v: 100 };
const BLUE: Hsv = { h: 225, s: 100, v: 100 };

/** Entier aleatoire dans [min, max]. */
const between = (min: number, max: number) => min + Math.round(Math.random() * (max - min));

export const SCENARIOS: readonly Scenario[] = [
  {
    id: 'clignotement',
    name: 'Clignotement',
    description: "L'ampoule s'allume et s'eteint sans fin. Utile comme minuteur visible de loin.",
    roles: 1,
    loops: true,
    frame: (step) => ({ cues: [{ on: step % 2 === 0 }], holdMs: 400 }),
  },
  {
    id: 'gyrophare',
    name: 'Gyrophare',
    description: 'Rouge et bleu alternes, facon voiture de police. Avec deux ampoules, elles se repondent.',
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
  },
  {
    id: 'respiration',
    name: 'Respiration',
    description: "L'intensite monte et descend lentement, en gardant la couleur en place. Calme, pour travailler.",
    roles: 1,
    loops: true,
    // On ne touche QUE l'intensite : la teinte reste celle que l'utilisateur
    // avait choisie, ce qui rend le scenario utilisable sur un blanc comme sur
    // une couleur sans le denaturer.
    frame: (step) => {
      const phase = step % 12;
      const climb = phase < 6 ? phase : 11 - phase;
      return { cues: [{ on: true, brightness: 15 + Math.round((climb / 5) * 85) }], holdMs: 320 };
    },
  },
  {
    id: 'bougie',
    name: 'Bougie',
    description: 'Une flamme chaude qui vacille, jamais deux fois pareil. Le meilleur rendu de la serie.',
    roles: 1,
    loops: true,
    // Aleatoire ASSUME : une bougie reguliere ne ressemble a rien. Teinte et
    // intensite varient dans une plage etroite — c'est l'irregularite des
    // DUREES qui fait l'essentiel de l'illusion.
    frame: () => ({
      cues: [{ on: true, color: { h: between(24, 38), s: between(70, 90), v: between(45, 90) } }],
      holdMs: between(260, 480),
    }),
  },
  {
    id: 'orage',
    name: 'Orage',
    description: 'Une penombre bleutee, dechiree par des eclairs blancs a intervalles irreguliers.',
    roles: 1,
    loops: true,
    // Deux periodes premieres entre elles (7 et 11) suffisent a produire des
    // eclairs qui ne retombent jamais sur le meme rythme, sans tirage aleatoire
    // et donc sans rendre le scenario intestable.
    frame: (step) => (step % 7 === 3 || step % 11 === 5)
      ? { cues: [{ on: true, color: { h: 210, s: 8, v: 100 } }], holdMs: 260 }
      : { cues: [{ on: true, color: { h: 225, s: 60, v: 12 } }], holdMs: 900 },
  },
  {
    id: 'arc-en-ciel',
    name: 'Arc-en-ciel',
    description: 'La teinte tourne doucement sur tout le cercle chromatique.',
    roles: 1,
    loops: true,
    frame: (step) => ({
      cues: [{ on: true, color: { h: (step * 12) % 360, s: 95, v: 90 } }],
      holdMs: 380,
    }),
  },
  {
    id: 'alerte',
    name: 'Alerte',
    description: 'Trois eclats rouges, puis la lampe revient exactement comme elle etait. Pour signaler un evenement.',
    roles: 1,
    loops: false,
    steps: 6,
    frame: (step) => step % 2 === 0
      ? { cues: [{ on: true, color: RED }], holdMs: 280 }
      : { cues: [{ on: false }], holdMs: 260 },
  },
  {
    id: 'lever-de-soleil',
    name: 'Lever de soleil',
    description: "Cinq minutes d'une braise sombre jusqu'au plein jour. A lancer pour se reveiller en douceur.",
    roles: 1,
    loops: false,
    steps: 60,
    // Une seule rampe continue : la teinte passe de l'ambre profond au blanc
    // chaud pendant que l'intensite monte de 5 a 100. Les trois grandeurs
    // avancent ensemble, sinon on obtient un jaune plat qui s'eclaire.
    frame: (step) => {
      const t = Math.min(1, step / 59);
      return {
        cues: [{
          on: true,
          color: { h: 12 + Math.round(t * 28), s: Math.round(95 - t * 55), v: 5 + Math.round(t * 95) },
        }],
        holdMs: 5000,
      };
    },
  },
];

/** Le scenario portant cet identifiant, ou undefined. */
export function byId(id: string | undefined): Scenario | undefined {
  return id ? SCENARIOS.find((s) => s.id === id) : undefined;
}
