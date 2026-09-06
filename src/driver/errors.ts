/**
 * Causes de panne d'une lampe, en vocabulaire metier.
 *
 * Ce que fait ce module : ranger les echecs du transport en QUATRE causes que
 * l'utilisateur peut distinguer et, pour l'une d'elles, reparer lui-meme.
 *
 * LE CHOIX NON EVIDENT, ET LA RAISON D'ETRE DU FICHIER : sans ce classement,
 * toutes les pannes se ressemblent — la touche clignote, et rien ne dit si
 * l'ampoule est debranchee ou si la cle locale a ete regeneree par l'appli
 * Calex. Or ces deux cas appellent des gestes opposes : attendre, ou rouvrir le
 * panneau de configuration. Une cle refusee est la seule panne que l'utilisateur
 * repare seul ; la noyer dans un « hors ligne » generique lui cache justement
 * l'action qu'il pouvait mener.
 *
 * D'OU VIENNENT LES SIGNATURES : elles sont relevees dans le code de tuyapi 7.x,
 * pas devinees. La bibliotheque n'expose ni code d'erreur ni classe typee — elle
 * leve des `Error` dont seul le message distingue les cas — donc le message est
 * le seul discriminant disponible. Le prix a payer est connu : une mise a jour
 * de tuyapi qui reformule un message fait retomber le cas dans « unknown ».
 * C'est un repli sur, jamais un mauvais diagnostic, et le test unitaire cite les
 * lignes d'origine pour que la verification soit mecanique.
 *
 * SECRET : ces messages ne portent JAMAIS la cle locale. Ils citent des HMAC
 * derives et des fragments de trame chiffree, pas le secret lui-meme — c'est ce
 * qui autorise a les journaliser (garde-fou n°3).
 *
 * Invariants a preserver :
 *   - aucune syntaxe TypeScript non effacable ici (ni `enum`, ni propriete de
 *     parametre) : le module doit s'executer sous Node sans etape de build,
 *     c'est ce qui permet aux tests de tourner sur les sources ;
 *   - une cause inconnue ne leve jamais : elle retombe sur `unknown`.
 *
 * Usage canonique :
 *   try { await bulb.read(); }
 *   catch (error) { if (asLightError(error).failure === 'badKey') ... }
 */

/**
 * Ce qui empeche la lampe de repondre.
 *
 * Union de chaines plutot qu'`enum` : une enumeration TypeScript produit du code
 * a l'execution, ce que l'effacement de types de Node refuse.
 */
export type LightFailure =
  /** La cle locale ne dechiffre pas. Reparable par l'utilisateur, dans le panneau. */
  | 'badKey'
  /** Rien au bout du fil : ampoule hors tension, hors reseau, ou adresse perimee. */
  | 'unreachable'
  /** La connexion est etablie, mais l'ampoule reste muette. */
  | 'unresponsive'
  /** Tout le reste. Repli sur, jamais un diagnostic invente. */
  | 'unknown';

/**
 * Fragments de message qui identifient une cause, du plus specifique au plus large.
 *
 * L'ordre compte : « badKey » passe en premier parce que c'est le seul verdict
 * qui demande un geste a l'utilisateur, et qu'aucune de ses signatures ne se
 * retrouve dans les autres familles.
 */
const SIGNATURES: readonly (readonly [LightFailure, readonly string[]])[] = [
  ['badKey', ['decrypt failed', 'hmac mismatch', 'crc mismatch', 'missing key or version']],
  ['unresponsive', ['timeout waiting for status response']],
  ['unreachable', [
    'find() timed out',
    'connection timed out',
    'error from socket',
    'econnrefused',
    'econnreset',
    'ehostunreach',
    'enetunreach',
    'etimedout',
    'epipe',
  ]],
];

/**
 * Texte ou chercher les signatures.
 *
 * Le code systeme est prefixe au message : Node le pose sur l'erreur sans
 * toujours l'ecrire dans le texte, et c'est parfois le seul indice. Accepte
 * n'importe quelle valeur — tuyapi emet parfois un Buffer brut en guise
 * d'erreur (index.js:655), et une sonde qui plante en analysant une panne
 * remplacerait un symptome lisible par une seconde panne.
 */
function searchableText(error: unknown): string {
  if (error instanceof Error) {
    const code = 'code' in error ? String((error as { code?: unknown }).code ?? '') : '';
    return (code + ' ' + error.message).toLowerCase();
  }
  return String(error).toLowerCase();
}

/** Range une erreur de transport dans l'une des quatre causes. Ne leve jamais. */
export function classify(error: unknown): LightFailure {
  const text = searchableText(error);
  for (const [failure, fragments] of SIGNATURES) {
    if (fragments.some((fragment) => text.includes(fragment))) return failure;
  }
  return 'unknown';
}

/**
 * Panne de lampe, cause deja etablie.
 *
 * Le champ est assigne dans le corps du constructeur plutot qu'en propriete de
 * parametre : cette derniere syntaxe exige une transformation que Node ne fait
 * pas (garde-fou n°4).
 */
export class LightError extends Error {
  readonly failure: LightFailure;

  constructor(failure: LightFailure, cause: unknown) {
    // `cause` plutot qu'un message recopie : l'erreur d'origine reste entiere,
    // avec sa pile, pour qui veut la lire dans le journal.
    super('lampe injoignable : ' + failure, { cause });
    this.name = 'LightError';
    this.failure = failure;
  }
}

/**
 * Renvoie l'erreur deja classee, ou la classe.
 *
 * IDEMPOTENT a dessein : le pilote leve une LightError, le reservoir la
 * retransmet, l'action la recoit. Emballer a chaque etage enfouirait la cause
 * d'origine d'un cran a chaque fois, et le journal finirait par citer une pile
 * qui ne designe plus rien.
 */
export function asLightError(error: unknown): LightError {
  if (error instanceof LightError) return error;
  return new LightError(classify(error), error);
}
