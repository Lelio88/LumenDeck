/**
 * Reprise d'une touche restee en panne.
 *
 * Ce que fait ce module : replanifier une relecture pour les seules touches qui
 * affichent une panne, jusqu'a ce que ca reparte — puis se taire.
 *
 * LE CHOIX NON EVIDENT, ET LA RAISON D'ETRE DU FICHIER : les actions sont
 * purement evenementielles ; rien n'interroge l'ampoule de lui-meme. Une touche
 * qui a affiche « Hors ligne » gardait donc ce mot longtemps apres le retour du
 * courant, jusqu'au prochain appui ou changement de page. C'est le defaut que
 * l'en-tete de toggle.ts condamne — une touche qui ment est pire qu'une touche
 * sans etat — simplement pris a l'envers.
 *
 * POURQUOI PAS UN SONDAGE GENERAL : une ampoule Tuya n'accepte qu'une poignee de
 * connexions simultanees (voir driver/pool.ts). Interroger periodiquement TOUTES
 * les touches gaspillerait ce budget pour confirmer, la plupart du temps, que
 * tout va bien. Ici seule une touche en echec se replanifie, et elle s'arrete
 * d'elle-meme des qu'elle a repris.
 *
 * COMMENT LE SUCCES EST DETECTE, sans que les actions aient a le dire : chaque
 * echec incremente un compteur. Si une relecture se termine sans l'avoir
 * incremente, c'est qu'elle n'a rien signale — donc qu'elle a reussi. Les
 * chemins nominaux des actions n'ont ainsi pas une ligne a ajouter, ce qui evite
 * la classe de bugs ou l'on oublie d'annuler le cycle sur l'une des cinq.
 *
 * N'importe RIEN, pas meme le SDK : c'est ce qui permet de le tester avec des
 * minuteries simulees, sans Stream Deck ni ampoule.
 *
 * Usage canonique :
 *   scheduleRecovery(ev.action.id, () => this.refresh(target, settings));
 *   cancelRecovery(ev.action.id);   // sur onWillDisappear
 */

/** Ce que la touche doit refaire pour tenter de reprendre : sa relecture habituelle. */
export type Recover = () => Promise<void>;

/**
 * Bareme d'attente entre deux tentatives, en millisecondes.
 *
 * Court d'abord — une coupure wifi dure souvent quelques secondes — puis de plus
 * en plus espace : passe cinq minutes, l'ampoule est debranchee pour de bon, et
 * insister ne ferait que consommer son budget de connexions. La derniere valeur
 * se rejoue indefiniment plutot que de doubler sans fin.
 */
export const DELAIS_MS = [15_000, 30_000, 60_000, 300_000] as const;

type Cycle = {
  readonly timer: ReturnType<typeof setTimeout>;
  /** Rang dans le bareme ci-dessus. */
  readonly rang: number;
};

/** Cycles en cours, indexes par identifiant d'instance de touche. */
const cycles = new Map<string, Cycle>();

/** Nombre d'echecs signales par touche. Sert a reconnaitre une reprise reussie. */
const echecs = new Map<string, number>();

/**
 * Signale un echec sur cette touche et programme la relecture suivante.
 *
 * Appelee a chaque panne : la premiere fois elle ouvre le cycle, les suivantes
 * l'allongent d'un cran.
 */
export function scheduleRecovery(id: string, recover: Recover): void {
  echecs.set(id, (echecs.get(id) ?? 0) + 1);

  const precedent = cycles.get(id);
  if (precedent) clearTimeout(precedent.timer);
  const rang = precedent ? Math.min(precedent.rang + 1, DELAIS_MS.length - 1) : 0;

  const timer = setTimeout(() => void tenter(id, recover), DELAIS_MS[rang]);
  // Une relecture en attente ne doit pas retenir le processus a l'extinction du
  // plugin : Stream Deck attend qu'il rende la main.
  timer.unref?.();
  cycles.set(id, { timer, rang });
}

/**
 * Rejoue la relecture, et clot le cycle si elle a repare.
 *
 * Le compteur est releve AVANT : si la relecture echoue, elle rappellera
 * scheduleRecovery et l'aura incremente, ce qui suffit a distinguer les deux
 * issues sans que l'appelant ait a rendre de verdict.
 */
async function tenter(id: string, recover: Recover): Promise<void> {
  const avant = echecs.get(id) ?? 0;
  await recover();
  if ((echecs.get(id) ?? 0) === avant) cancelRecovery(id);
}

/** Arrete le cycle et oublie la touche. Sans effet si elle n'en avait pas. */
export function cancelRecovery(id: string): void {
  const cycle = cycles.get(id);
  if (cycle) clearTimeout(cycle.timer);
  cycles.delete(id);
  echecs.delete(id);
}

/** Nombre de touches en cours de reprise. Existe pour que les tests l'observent. */
export function pendingRecoveries(): number {
  return cycles.size;
}
