/**
 * Designation de PLUSIEURS ampoules par une touche, et fan-out des commandes.
 *
 * Ce que fait ce module : dire quelles ampoules une touche vise, et appliquer
 * une operation a chacune sans qu'une panne n'en prive les autres.
 *
 * Choix non evidents :
 *
 *   - La liste cochee (`deviceIds`) l'emporte, mais les anciens champs
 *     `deviceId` / `deviceId2` restent LUS. Une touche posee par une version
 *     anterieure doit continuer de piloter sa lampe sans que l'utilisateur ait
 *     ouvert le panneau ; `adoptGroup` les recopie ensuite dans la liste, pour
 *     que le panneau montre ce qui est reellement pilote.
 *
 *   - `fanOut` n'echoue JAMAIS : il rend les valeurs ET les pannes. Une lampe
 *     debranchee dans un groupe de trois ne doit pas empecher les deux autres
 *     d'obeir — l'appelant decide ensuite de ce qu'il en dit a l'utilisateur.
 *
 *   - `nextPower` : un groupe dont une lampe est allumee s'ETEINT. C'est la
 *     lecture que fait une personne devant une piece a moitie eclairee qui
 *     appuie sur « interrupteur » : elle veut tout eteindre, pas tout inverser.
 *
 * N'importe RIEN, pas meme le SDK : la regle se verifie sans Stream Deck ni
 * ampoule (voir face.ts, qui suit le meme principe).
 *
 * Invariant : l'ordre de `selectedIds` est celui des ROLES d'un scenario. La
 * premiere ampoule est la principale — c'est elle que la touche interroge pour
 * se dessiner.
 *
 * Usage canonique :
 *   const { values, errors } = await fanOut(coords, (c) => withRetry(c, op));
 */

/** Ce que la touche memorise du choix d'ampoules. Champs anterieurs compris. */
export type GroupSettings = {
  deviceIds?: unknown;
  /** @deprecated Une seule ampoule, avant les listes. Repris par `adoptGroup`. */
  deviceId?: unknown;
  /** @deprecated Seconde ampoule du scenario, avant les listes. Repris par `adoptGroup`. */
  deviceId2?: unknown;
};

const isId = (value: unknown): value is string => typeof value === 'string' && value.length > 0;

/** Retire les doublons en gardant le premier rang : l'ordre porte les roles. */
const unique = (ids: readonly string[]): string[] => [...new Set(ids)];

/**
 * Les identifiants vises par cette touche, dans l'ordre.
 *
 * Les valeurs illisibles sont ecartees plutot que propagees : les reglages
 * viennent d'un panneau, c'est-a-dire d'une page web.
 */
export function selectedIds(settings: GroupSettings): string[] {
  const listed = Array.isArray(settings.deviceIds) ? unique(settings.deviceIds.filter(isId)) : [];
  if (listed.length > 0) return listed;
  return unique([settings.deviceId, settings.deviceId2].filter(isId));
}

/** Surface minimale d'une touche pour ecrire ses reglages. */
export type Writable = {
  setSettings(settings: Record<string, unknown>): Promise<void>;
};

/**
 * Recopie les anciens champs dans la liste, une seule fois.
 *
 * Sans effet sur une touche deja a jour ou sans ampoule designee : seule une
 * touche qui porte encore `deviceId` ou `deviceId2` est reecrite.
 */
export async function adoptGroup(action: Writable, settings: GroupSettings & Record<string, unknown>): Promise<void> {
  if (!isId(settings.deviceId) && !isId(settings.deviceId2)) return;

  const { deviceId: _deviceId, deviceId2: _deviceId2, ...rest } = settings;
  await action.setSettings({ ...rest, deviceIds: selectedIds(settings) });
}

/** Une panne, avec l'element qui l'a causee. */
export type Failure<T> = { readonly item: T; readonly error: unknown };

/** Reglages facultatifs de `fanOut`. */
export type FanOutOptions = {
  /**
   * Temps laisse aux retardataires une fois que la PREMIERE lampe a repondu.
   *
   * Pour une relecture : une lampe debranchee met ~5 s a declarer forfait, et
   * toute la touche attendrait apres elle. Passe ce delai, les lampes
   * encore muettes sont laissees de cote — ni valeur, ni panne : on ne sait pas.
   * Absent, on attend tout le monde. Tant qu'aucune lampe n'a REUSSI, le delai
   * ne court pas : une vraie panne doit etre rapportee.
   */
  readonly graceMs?: number;
};

/**
 * Applique `op` a chaque element EN PARALLELE et rend tout ce qui s'est passe.
 *
 * `values` suit l'ordre des elements reussis ; `errors` nomme ceux qui ont
 * echoue. Ne leve jamais, et ne laisse aucun rejet sans garde derriere lui : un
 * retardataire qui echoue apres coup est absorbe, faute de quoi Node tuerait le
 * processus du plugin.
 */
export async function fanOut<T, R>(
  items: readonly T[],
  op: (item: T) => Promise<R>,
  options: FanOutOptions = {},
): Promise<{ values: R[]; errors: Failure<T>[] }> {
  type Outcome = { index: number; ok: true; value: R } | { index: number; ok: false; error: unknown };

  const answered: Outcome[] = [];
  const pending = items.map((item, index) => op(item).then(
    (value): Outcome => ({ index, ok: true, value }),
    (error: unknown): Outcome => ({ index, ok: false, error }),
  ).then((outcome) => { answered.push(outcome); return outcome; }));

  const everyone = Promise.all(pending);
  if (options.graceMs === undefined) {
    await everyone;
  } else {
    const grace = options.graceMs;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const firstSuccessPlusGrace = new Promise<void>((resolve) => {
      for (const outcome of pending) {
        void outcome.then((o) => { if (o.ok && timer === undefined) timer = setTimeout(resolve, grace); });
      }
    });
    await Promise.race([everyone, firstSuccessPlusGrace]);
    if (timer !== undefined) clearTimeout(timer);
  }

  const values: R[] = [];
  const errors: Failure<T>[] = [];
  for (const outcome of [...answered].sort((a, b) => a.index - b.index)) {
    if (outcome.ok) values.push(outcome.value);
    else errors.push({ item: items[outcome.index] as T, error: outcome.error });
  }
  return { values, errors };
}

/** L'etat que doit prendre un groupe d'apres l'etat allume / eteint de ses lampes. */
export function nextPower(on: readonly boolean[]): boolean {
  return !on.some(Boolean);
}
