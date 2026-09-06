/**
 * Reservoir de connexions aux ampoules, partage par toutes les actions.
 *
 * Ce que fait ce module : garantir qu'une meme ampoule n'est jointe que par UNE
 * connexion, quel que soit le nombre de touches configurees dessus.
 *
 * Choix non evident, et raison d'etre du module : une ampoule Tuya n'accepte
 * qu'un nombre tres restreint de connexions simultanees. Un Stream Deck avec une
 * touche « allumer », une touche « + » et une molette pointant la meme ampoule
 * ouvrirait trois sessions et provoquerait des echecs erratiques, tres penibles a
 * diagnostiquer car dependants de l'ordre d'apparition des touches.
 *
 * Invariant : les actions ne construisent JAMAIS un TuyaLanDriver directement,
 * elles passent toujours par acquire().
 *
 * Usage canonique :
 *   const bulb = await acquire({ id, key, ip });
 *   await bulb.togglePower();
 */
import type { LightDriver } from './types.js';
import { asLightError, type LightFailure } from './errors.ts';
import { TuyaLanDriver, type TuyaLanConfig } from './tuya.ts';

/**
 * Causes qu'une reconnexion ne peut pas reparer.
 *
 * `unresponsive` et `unknown` en sont absents a dessein : la premiere decrit une
 * session etablie mais muette — precisement ce qu'une session neuve repare — et
 * la seconde est un repli dont on ignore la nature, ou la reprise reste le pari
 * le plus sur.
 */
const SANS_REPRISE: readonly LightFailure[] = ['badKey', 'unreachable'];

/** Connexions vivantes, indexees par identifiant d'ampoule. */
const pool = new Map<string, Promise<LightDriver>>();

/**
 * Renvoie la connexion de cette ampoule, en l'ouvrant au besoin.
 *
 * En cas d'echec, l'entree est retiree du reservoir pour que la tentative
 * suivante reparte sur une connexion neuve plutot que de rejouer indefiniment
 * une promesse deja rejetee.
 */
export async function acquire(config: TuyaLanConfig): Promise<LightDriver> {
  const existing = pool.get(config.id);
  if (existing) return existing;

  const opening = TuyaLanDriver.connect(config).catch((err: unknown) => {
    pool.delete(config.id);
    throw err;
  });
  pool.set(config.id, opening);
  return opening;
}

/** Ferme une connexion et l'oublie. Sans effet si l'ampoule n'etait pas jointe. */
export async function release(deviceId: string): Promise<void> {
  const pending = pool.get(deviceId);
  if (!pending) return;
  pool.delete(deviceId);
  try {
    const driver = await pending;
    await driver.close();
  } catch {
    // Une connexion qui n'a jamais abouti n'a rien a fermer.
  }
}

/** Ferme tout. Appele a l'extinction du plugin. */
export async function releaseAll(): Promise<void> {
  await Promise.all([...pool.keys()].map(release));
}

/**
 * Rejoue une operation une fois apres avoir reouvert la connexion.
 *
 * Une ampoule redemarre, change d'adresse ou coupe la session au bout d'un temps
 * d'inactivite : la premiere commande echoue alors sans que rien ne soit casse.
 * Retenter une fois evite d'imposer a l'utilisateur un appui « pour rien ».
 *
 * La reprise est CONDITIONNELLE : rouvrir une session ne repare qu'une session.
 * Une ampoule hors tension ou une cle refusee resteront exactement ce qu'elles
 * sont a la seconde tentative — on ne fait alors qu'ajouter une attente a une
 * panne deja acquise. Le cas le plus visible est l'ampoule debranchee : le delai
 * de connexion de tuyapi etant de cinq secondes, la reprise systematique faisait
 * patienter DIX secondes devant une touche qui semblait figee.
 *
 * En cas de double echec, la cause remontee est classee et jamais perdue : la
 * premiere tentative reste la reference si la seconde n'a rien su dire.
 */
export async function withRetry<T>(
  config: TuyaLanConfig,
  operation: (bulb: LightDriver) => Promise<T>,
): Promise<T> {
  try {
    return await operation(await acquire(config));
  } catch (first) {
    // Toujours relacher, meme sans reprise : l'entree du reservoir pointe une
    // session morte, et la garder condamnerait aussi la commande suivante —
    // y compris apres que l'utilisateur a corrige la cle ou rebranche la lampe.
    await release(config.id);

    const cause = asLightError(first);
    if (SANS_REPRISE.includes(cause.failure)) throw cause;

    try {
      return await operation(await acquire(config));
    } catch (second) {
      // La SECONDE tentative decrit l'etat present et prime donc a egalite ;
      // on ne retombe sur la premiere que si la seconde n'a rien su dire.
      const retry = asLightError(second);
      throw retry.failure === 'unknown' ? cause : retry;
    }
  }
}
