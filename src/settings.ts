/**
 * Reglages persistes par Stream Deck pour chaque touche.
 *
 * Invariant de securite : la local_key est un secret propre au reseau local de
 * l'utilisateur. Elle vit dans les reglages de l'action, geres par Stream Deck,
 * et ne doit jamais etre journalisee ni quitter la machine.
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

/** Reglages de l'action de reglage d'intensite. */
export type BrightnessSettings = BulbSettings & {
  /** Pas applique a chaque cran, en points de pourcentage. Defaut 10. */
  step?: number;
};

/** Vrai si les reglages suffisent a joindre une ampoule. */
export function isConfigured(s: BulbSettings): s is BulbSettings & { deviceId: string; localKey: string } {
  return typeof s.deviceId === 'string' && s.deviceId.length > 0
      && typeof s.localKey === 'string' && s.localKey.length > 0;
}
