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

import { adoptGroup, selectedIds, type GroupSettings, type Writable } from './actions/group.js';
import { readGlobal, updateGlobal } from './globals.js';
import { mergeBulb, withoutBulb, type KnownBulb } from './registry.js';

export type { KnownBulb };

// Le registre vit sous la cle `bulbs` des reglages globaux, a cote d'autres
// donnees (voir globals.ts) : on n'ecrit JAMAIS l'objet entier.
async function readAll(): Promise<KnownBulb[]> {
  const bulbs = await readGlobal<KnownBulb[]>('bulbs');
  return Array.isArray(bulbs) ? bulbs : [];
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
  // La fusion se calcule SUR la liste courante, dans la file du magasin : deux
  // enregistrements simultanes se cumulent au lieu de s'ecraser, ce qui ferait
  // perdre une cle locale saisie et introuvable ailleurs.
  await updateGlobal<KnownBulb[]>('bulbs', (current) => mergeBulb(current ?? [], bulb));
}

/** Retire une ampoule du registre. Les touches qui la designaient afficheront « A regler ». */
export async function forget(id: string): Promise<void> {
  await updateGlobal<KnownBulb[]>('bulbs', (current) => withoutBulb(current ?? [], id));
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

type LegacySettings = GroupSettings & { localKey?: string; ip?: string };

/** Ce que `adoptLegacy` sait reprendre d'une touche : identifiant, cle et adresse d'origine. */
function legacyOf(settings: LegacySettings): { deviceId?: string; localKey?: string; ip?: string } {
  return {
    ...(typeof settings.deviceId === 'string' ? { deviceId: settings.deviceId } : {}),
    ...(settings.localKey ? { localKey: settings.localKey } : {}),
    ...(settings.ip ? { ip: settings.ip } : {}),
  };
}

/**
 * Met une touche a jour des qu'elle apparait : cle au registre, ampoules en liste.
 *
 * L'ORDRE est la raison d'etre de cette fonction. `adoptGroup` retire `deviceId`
 * des reglages, or `adoptLegacy` a besoin de `deviceId` ET de `localKey` pour
 * recopier la cle au registre. Dans l'ordre inverse, une interruption entre les
 * deux laisserait une cle orpheline, sans identifiant pour la rattacher : la
 * touche resterait « A regler » pour toujours.
 *
 * Un echec est journalise et n'empeche pas la touche de se dessiner : la reprise
 * se retentera a la prochaine apparition, puisque les anciens champs restent.
 */
export async function adoptBulbs(action: Writable, settings: LegacySettings & Record<string, unknown>): Promise<void> {
  try {
    await adoptLegacy(legacyOf(settings));
    await adoptGroup(action, settings);
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : String(error);
    streamDeck.logger.createScope('bulbs').warn('reprise des anciens reglages impossible : ' + detail);
  }
}

/** Etiquette affichable d'une ampoule : son nom, sinon un identifiant abrege. */
export function label(bulb: KnownBulb): string {
  if (bulb.name) return bulb.name;
  return 'Ampoule ' + bulb.id.slice(-6);
}

/** Ce qu'il faut pour joindre une ampoule : le pilote n'en demande pas davantage. */
export type Coordinates = { id: string; key: string; ip?: string; version?: string };

/**
 * Traduit les reglages d'une touche en coordonnees utilisables, dans l'ordre
 * des ampoules choisies. Liste vide si aucune n'est joignable.
 *
 * C'est le point d'entree UNIQUE des actions : une seule question a poser, une
 * seule reponse a tester. Rendre une liste vide plutot que de lever une
 * exception laisse l'action afficher « A regler » sans avoir a distinguer les
 * causes — touche neuve, ampoules retirees du registre, ou cle jamais saisie
 * reviennent au meme pour l'utilisateur : il faut aller dans le panneau.
 *
 * Une ampoule du choix qui n'est plus au registre, ou sans cle, est ECARTEE
 * sans bruit : les autres obeissent. Si plus aucune ne reste et qu'UNE SEULE
 * ampoule est declaree, c'est elle : la question « laquelle ? » n'a qu'une
 * reponse, et l'exiger n'apporte rien a la grande majorite des installations.
 * Des qu'il y en a plusieurs, il n'existe pas de reponse evidente, et en
 * inventer une ferait piloter la mauvaise lampe — mieux vaut afficher
 * « A regler » et laisser choisir.
 *
 * Reprend au passage une configuration posee par une version anterieure.
 */
export async function coordinatesForMany(
  settings: LegacySettings,
): Promise<Coordinates[]> {
  await adoptLegacy(legacyOf(settings));

  const all = await readAll();
  const chosen = selectedIds(settings)
    .map((id) => all.find((b) => b.id === id))
    .filter((b): b is KnownBulb => b !== undefined && b.key.length > 0);
  const bulbs = chosen.length > 0 ? chosen : all.length === 1 && all[0]?.key ? [all[0]] : [];

  return bulbs.map((bulb) => ({
    id: bulb.id,
    key: bulb.key,
    ...(bulb.ip ? { ip: bulb.ip } : {}),
    ...(bulb.version ? { version: bulb.version } : {}),
  }));
}
