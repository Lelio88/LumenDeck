/**
 * Registre des ampoules connues, partage par toutes les touches.
 *
 * Ce que fait ce module : conserver les coordonnees de chaque ampoule UNE SEULE
 * FOIS, dans les reglages globaux du plugin, pour qu'une touche n'ait plus qu'a
 * designer laquelle elle pilote.
 *
 * Choix non evident, et raison d'etre du module : la premiere version rangeait
 * identifiant, cle et adresse dans les reglages de CHAQUE touche. Configurer
 * quatre touches sur la meme ampoule imposait donc de saisir quatre fois les
 * memes secrets — penible, et surtout intenable a la rotation d'une cle, ou il
 * aurait fallu se souvenir de toutes les touches a corriger. Les reglages
 * globaux existent exactement pour ce cas.
 *
 * Invariants a preserver :
 *   - une ampoule est identifiee par son `id` Tuya, jamais par son nom ;
 *   - la cle locale ne quitte jamais ces reglages : elle n'est ni journalisee,
 *     ni renvoyee au panneau de configuration une fois enregistree ;
 *   - `remember` fusionne plutot qu'il n'ecrase, pour qu'une decouverte reseau
 *     (qui ignore la cle) ne detruise pas une cle deja saisie.
 *
 * Usage canonique :
 *   await remember({ id, key, ip, name });
 *   const bulb = await resolve(settings.deviceId);
 */
import streamDeck from '@elgato/streamdeck';

/** Une ampoule declaree par l'utilisateur, cle comprise. */
export type KnownBulb = {
  /** Identifiant Tuya. Cle primaire du registre. */
  id: string;
  /** Cle locale de chiffrement. Secret : ne jamais journaliser ni reafficher. */
  key: string;
  /** Adresse sur le reseau local. Absente, l'ampoule est cherchee par diffusion. */
  ip?: string;
  /** Nom lisible, pour que les listes affichent autre chose qu'un identifiant. */
  name?: string;
};

type GlobalSettings = {
  bulbs?: KnownBulb[];
};

async function readAll(): Promise<KnownBulb[]> {
  const settings = await streamDeck.settings.getGlobalSettings<GlobalSettings>();
  return Array.isArray(settings.bulbs) ? settings.bulbs : [];
}

async function writeAll(bulbs: KnownBulb[]): Promise<void> {
  await streamDeck.settings.setGlobalSettings<GlobalSettings>({ bulbs });
}

/** Toutes les ampoules declarees. */
export function list(): Promise<KnownBulb[]> {
  return readAll();
}

/** L'ampoule portant cet identifiant, ou undefined. */
export async function resolve(id: string | undefined): Promise<KnownBulb | undefined> {
  if (!id) return undefined;
  return (await readAll()).find((b) => b.id === id);
}

/**
 * Enregistre ou met a jour une ampoule.
 *
 * FUSIONNE avec l'existant : les champs absents de `bulb` conservent leur valeur
 * precedente. C'est ce qui permet a une decouverte reseau — qui rapporte
 * l'identifiant et l'adresse, jamais la cle — de rafraichir une adresse sans
 * effacer la cle deja saisie.
 */
export async function remember(bulb: Partial<KnownBulb> & { id: string }): Promise<void> {
  const bulbs = await readAll();
  const index = bulbs.findIndex((b) => b.id === bulb.id);

  if (index === -1) {
    bulbs.push({ id: bulb.id, key: bulb.key ?? '', ...(bulb.ip ? { ip: bulb.ip } : {}), ...(bulb.name ? { name: bulb.name } : {}) });
  } else {
    const previous = bulbs[index] as KnownBulb;
    bulbs[index] = {
      id: previous.id,
      key: bulb.key || previous.key,
      ...(bulb.ip ?? previous.ip ? { ip: bulb.ip ?? previous.ip } : {}),
      ...(bulb.name ?? previous.name ? { name: bulb.name ?? previous.name } : {}),
    };
  }
  await writeAll(bulbs);
}

/**
 * L'unique ampoule declaree, quand il n'y en a qu'une.
 *
 * Sert de repli a une touche qui n'en designe aucune : avec un seul appareil au
 * registre, la question « laquelle ? » n'a qu'une reponse, et l'exiger n'apporte
 * rien. C'est le cas de la grande majorite des installations.
 *
 * Rend undefined des qu'il y en a zero ou plusieurs. Avec plusieurs, il n'existe
 * pas de reponse evidente, et en inventer une ferait piloter la mauvaise lampe —
 * mieux vaut alors afficher « A regler » et laisser choisir.
 */
export async function soleBulb(): Promise<KnownBulb | undefined> {
  const all = await readAll();
  return all.length === 1 ? all[0] : undefined;
}

/** Retire une ampoule du registre. Les touches qui la designaient afficheront « A regler ». */
export async function forget(id: string): Promise<void> {
  await writeAll((await readAll()).filter((b) => b.id !== id));
}

/**
 * Reprend une configuration posee touche par touche par une version anterieure.
 *
 * Les premieres versions stockaient la cle dans les reglages de chaque touche.
 * Plutot que d'obliger l'utilisateur a tout ressaisir apres mise a jour, on
 * adopte silencieusement ce qu'on trouve — une seule fois, puisque `remember`
 * fusionne et qu'une cle deja presente n'est jamais ecrasee par du vide.
 */
export async function adoptLegacy(legacy: { deviceId?: string; localKey?: string; ip?: string }): Promise<void> {
  if (!legacy.deviceId || !legacy.localKey) return;
  const existing = await resolve(legacy.deviceId);
  if (existing?.key) return;
  await remember({ id: legacy.deviceId, key: legacy.localKey, ...(legacy.ip ? { ip: legacy.ip } : {}) });
}

/** Etiquette affichable d'une ampoule : son nom, sinon un identifiant abrege. */
export function label(bulb: KnownBulb): string {
  if (bulb.name) return bulb.name;
  return 'Ampoule ' + bulb.id.slice(-6);
}

/**
 * Traduit les reglages d'une touche en coordonnees utilisables, ou null.
 *
 * C'est le point d'entree UNIQUE des actions : une seule question a poser, une
 * seule reponse a tester. Renvoyer null plutot que de lever une exception laisse
 * l'action afficher « A regler » sans avoir a distinguer les causes — touche
 * neuve, ampoule retiree du registre, ou cle jamais saisie reviennent au meme
 * pour l'utilisateur : il faut aller dans le panneau de configuration.
 *
 * Reprend au passage une configuration posee par une version anterieure.
 */
export async function coordinatesFor(
  settings: { deviceId?: string; localKey?: string; ip?: string },
): Promise<{ id: string; key: string; ip?: string } | null> {
  await adoptLegacy(settings);

  const bulb = (await resolve(settings.deviceId)) ?? (await soleBulb());
  if (!bulb || !bulb.key) return null;

  return bulb.ip
    ? { id: bulb.id, key: bulb.key, ip: bulb.ip }
    : { id: bulb.id, key: bulb.key };
}
