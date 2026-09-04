/**
 * Reglages persistes par Stream Deck pour chaque touche.
 *
 * Ce que fait ce module : decrire la forme de ce qu'une touche memorise, et
 * fournir les deux fonctions que TOUTES les actions utilisent avant d'agir —
 * verifier que la touche est configuree, et traduire ses reglages en
 * coordonnees d'ampoule.
 *
 * Invariant de securite : la local_key est un secret propre au reseau local de
 * l'utilisateur. Elle vit dans les reglages de l'action, geres par Stream Deck,
 * et ne doit jamais etre journalisee ni quitter la machine. C'est la raison pour
 * laquelle le niveau de journalisation du plugin est `info` et non `trace`.
 *
 * Usage canonique :
 *   if (!isConfigured(settings)) { await action.setTitle('A regler'); return; }
 *   await withRetry(coordinates(settings), (bulb) => bulb.togglePower());
 */

/** Coordonnees d'une ampoule, communes a toutes les actions. */
export type BulbSettings = {
  /** Identifiant Tuya de l'ampoule. */
  deviceId?: string;
  /** Cle locale de chiffrement. Secret : ne jamais journaliser. */
  localKey?: string;
  /** Adresse IP sur le reseau local. Vide, l'ampoule est cherchee par diffusion. */
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

/**
 * Vrai si les reglages suffisent a joindre une ampoule.
 *
 * GENERIQUE a dessein. Une signature figee sur BulbSettings ecraserait le type
 * plus precis a la sortie du garde : une action couleur perdrait son champ
 * `color`, une action temperature son `kelvin`. Le parametre T preserve le type
 * reel tout en ajoutant la garantie sur l'identifiant et la cle.
 */
export function isConfigured<T extends BulbSettings>(
  s: T,
): s is T & { deviceId: string; localKey: string } {
  return (
    typeof s.deviceId === 'string' && s.deviceId.length > 0 &&
    typeof s.localKey === 'string' && s.localKey.length > 0
  );
}

/**
 * Traduit les reglages d'une touche en coordonnees pour le reservoir.
 *
 * L'adresse est omise si elle est vide plutot que passee comme chaine vide :
 * le pilote distingue « pas d'adresse, cherche-la » de « adresse fournie », et
 * une chaine vide ferait echouer la connexion au lieu de declencher la recherche.
 */
export function coordinates(s: BulbSettings & { deviceId: string; localKey: string }) {
  return s.ip
    ? { id: s.deviceId, key: s.localKey, ip: s.ip }
    : { id: s.deviceId, key: s.localKey };
}
