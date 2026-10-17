/**
 * Magasin des reglages globaux : lecture-modification-ecriture ATOMIQUE par cle.
 *
 * Ce que fait ce module : permettre a plusieurs modules (registre d'ampoules,
 * session Twitch) de partager l'objet unique des reglages globaux sans que l'un
 * n'efface l'autre.
 *
 * Choix non evidents, et raison d'etre du module :
 *
 *   - L'ecriture REMPLACE l'objet entier cote Stream Deck. Serialiser les seules
 *     ecritures ne suffit donc pas : deux modifications simultanees liraient
 *     chacune le meme etat de depart, et la seconde effacerait la premiere —
 *     c'est ainsi qu'une cle locale saisie pouvait disparaitre. La LECTURE et
 *     le calcul de la nouvelle valeur ont lieu DANS la file, avec la valeur
 *     courante en main.
 *
 *   - Les lectures passent dans la meme file. Le SDK ne correle pas ses reponses
 *     (une lecture prend la prochaine reponse venue) : une lecture hors file,
 *     lancee pendant une ecriture, pourrait recevoir un etat perime.
 *
 *   - Une lecture sans reponse est abandonnee apres un delai. Sinon une reponse
 *     perdue figerait la file, donc toutes les ecritures suivantes — dont le
 *     renouvellement de jeton, et avec lui les rachats des viewers.
 *
 *   - Une operation qui echoue ne bloque pas les suivantes.
 *
 * Invariant : ne jamais journaliser le contenu — cles locales et jetons.
 *
 * L'entree-sortie est injectee : le module n'importe pas le SDK et se teste
 * avec un faux disque (voir globals.ts pour la liaison reelle).
 *
 * Usage canonique :
 *   const store = createGlobalStore({ read, write });
 *   await store.update('bulbs', (current) => [...(current ?? []), bulb]);
 */

type All = Record<string, unknown>;

export type StoreIo = {
  read(): Promise<All | undefined>;
  write(all: All): Promise<void>;
};

export type GlobalStore = {
  /** Lit une cle, apres les operations deja en file. */
  read<T>(key: string): Promise<T | undefined>;
  /** Modifie UNE cle. `change` recoit la valeur courante ; `undefined` en retour supprime la cle. Rend la valeur ecrite. */
  update<T>(key: string, change: (current: T | undefined) => T | undefined): Promise<T | undefined>;
};

/** Delai de grace d'une lecture. Stream Deck repond en quelques millisecondes. */
const READ_TIMEOUT_MS = 10_000;

export function createGlobalStore(io: StoreIo, options: { readTimeoutMs?: number } = {}): GlobalStore {
  const timeoutMs = options.readTimeoutMs ?? READ_TIMEOUT_MS;
  let tail: Promise<unknown> = Promise.resolve();

  /** Met une operation en file : elle commence quand toutes les precedentes sont finies, reussies ou non. */
  function enqueue<T>(job: () => Promise<T>): Promise<T> {
    const run = tail.then(job, job);
    tail = run.then(() => undefined, () => undefined);
    return run;
  }

  async function readAll(): Promise<All> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const expired = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('lecture des reglages globaux sans reponse : delai depasse')), timeoutMs);
    });
    try {
      return (await Promise.race([io.read(), expired])) ?? {};
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  return {
    read: <T>(key: string) => enqueue(async () => (await readAll())[key] as T | undefined),
    update: <T>(key: string, change: (current: T | undefined) => T | undefined) => enqueue(async () => {
      const all = await readAll();
      const next = change(all[key] as T | undefined);
      const { [key]: _replaced, ...others } = all;
      await io.write(next === undefined ? others : { ...others, [key]: next });
      return next;
    }),
  };
}
