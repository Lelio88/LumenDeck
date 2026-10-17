/**
 * Fusion pure des ampoules dans le registre.
 *
 * Ce que fait ce module : calculer la nouvelle liste d'ampoules apres un ajout,
 * une mise a jour ou un oubli, sans rien lire ni ecrire.
 *
 * Choix non evident : la fusion est une FONCTION de la liste courante, pas une
 * lecture suivie d'une ecriture. `bulbs.ts` la passe au magasin des reglages
 * globaux (`updateGlobal`), qui l'applique a la liste lue DANS sa file — c'est
 * ce qui empeche deux enregistrements simultanes de s'ecraser et de perdre une
 * cle locale, irrecuperable puisqu'elle ne se retrouve nulle part ailleurs.
 *
 * Invariant : ne modifie jamais la liste recue ; une decouverte reseau (qui
 * ignore la cle) ne doit jamais effacer une cle deja saisie.
 */

/** Une ampoule declaree par l'utilisateur, cle comprise (voir bulbs.ts). */
export type KnownBulb = {
  /** Identifiant Tuya. Cle primaire du registre. */
  id: string;
  /** Cle locale de chiffrement. Secret : ne jamais journaliser ni reafficher. */
  key: string;
  /** Adresse sur le reseau local. Absente, l'ampoule est cherchee par diffusion. */
  ip?: string;
  /** Nom lisible, pour que les listes affichent autre chose qu'un identifiant. */
  name?: string;
  /**
   * Version du protocole annoncee par l'ampoule, par exemple "3.4".
   *
   * Absente, le pilote retombe sur 3.3. C'est la decouverte reseau qui la
   * renseigne : elle figure dans l'annonce que l'ampoule diffuse d'elle-meme.
   */
  version?: string;
};

/** Ajoute ou met a jour une ampoule. Les champs absents de `patch` gardent leur valeur precedente. */
export function mergeBulb(bulbs: readonly KnownBulb[], patch: Partial<KnownBulb> & { id: string }): KnownBulb[] {
  const index = bulbs.findIndex((b) => b.id === patch.id);
  const previous = index === -1 ? undefined : bulbs[index];

  const ip = patch.ip ?? previous?.ip;
  const name = patch.name ?? previous?.name;
  const version = patch.version ?? previous?.version;
  const merged: KnownBulb = {
    id: patch.id,
    key: patch.key || previous?.key || '',
    ...(ip ? { ip } : {}),
    ...(name ? { name } : {}),
    ...(version ? { version } : {}),
  };

  return index === -1 ? [...bulbs, merged] : bulbs.map((b, i) => (i === index ? merged : b));
}

/** Retire une ampoule. */
export function withoutBulb(bulbs: readonly KnownBulb[], id: string): KnownBulb[] {
  return bulbs.filter((b) => b.id !== id);
}
