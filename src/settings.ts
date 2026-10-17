/**
 * Reglages persistes par Stream Deck pour chaque touche.
 *
 * Ce que fait ce module : decrire la forme de ce qu'une touche memorise.
 *
 * Choix non evident : une touche ne conserve que les IDENTIFIANTS des ampoules
 * qu'elle pilote, plus ce qui lui est propre (pas, couleur, temperature). La cle
 * locale et l'adresse vivent dans le registre partage (voir bulbs.ts), pour ne
 * les saisir qu'une fois quel que soit le nombre de touches.
 *
 * Les champs `localKey` et `ip` subsistent uniquement pour reprendre une
 * configuration posee par une version anterieure, qui les rangeait ici. Ils ne
 * sont plus jamais ecrits : `adoptLegacy` les recopie dans le registre au
 * premier affichage de la touche, puis ils sont ignores.
 */

/** Designation des ampoules pilotees, commune a toutes les actions. */
export type BulbSettings = {
  /**
   * Identifiants Tuya des ampoules cochees dans le registre, dans l'ordre.
   *
   * L'ordre compte pour un scenario : il est celui des roles. La premiere est
   * l'ampoule principale, celle d'apres laquelle la touche se dessine.
   */
  deviceIds?: string[];

  /** @deprecated Une seule ampoule, avant les listes. Lu par `selectedIds`, recopie par `adoptGroup`. */
  deviceId?: string;
  /** @deprecated Seconde ampoule du scenario, avant les listes. Lu par `selectedIds`, recopie par `adoptGroup`. */
  deviceId2?: string;

  /** @deprecated Heritage des premieres versions. Repris dans le registre, plus jamais ecrit. */
  localKey?: string;
  /** @deprecated Heritage des premieres versions. Repris dans le registre, plus jamais ecrit. */
  ip?: string;
};

/** Reglages de l'action d'intensite. */
export type BrightnessSettings = BulbSettings & {
  /** Pas applique a chaque cran, en points de pourcentage. Defaut 10. */
  step?: number;
};

/** Reglages de l'action de couleur. */
export type ColorSettings = BulbSettings & {
  /** Couleur appliquee a l'appui, notation `#rrggbb` du selecteur. */
  color?: string;
  /** Degres de teinte parcourus par cran de molette. Defaut 15. */
  step?: number;
};

/** Reglages de l'action de temperature de blanc. */
export type TemperatureSettings = BulbSettings & {
  /** Temperature appliquee a l'appui, en kelvins. Defaut 4000. */
  kelvin?: number;
  /** Kelvins parcourus par cran de molette. Defaut 200. */
  step?: number;
};

/** Reglages de l'action de scenario. */
export type ScenarioSettings = BulbSettings & {
  /** Identifiant du scenario choisi dans le catalogue. */
  scenarioId?: string;
};
