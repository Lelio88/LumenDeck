/**
 * Recuperation des cles locales aupres du cloud Tuya, par scan de QR code.
 *
 * Ce que fait ce module : obtenir, UNE FOIS, l'identifiant et la cle locale de
 * chaque ampoule du compte, pour que le pilotage puisse ensuite se passer
 * entierement du reseau. C'est la seule partie du plugin qui parle a un serveur.
 *
 * Pourquoi cela ne trahit pas la promesse « sans cloud » : la cle est CREEE par
 * l'application du fabricant au moment de l'appairage et n'existe nulle part
 * ailleurs. Aucune ampoule ne la divulgue sur le reseau local — la decouverte
 * UDP donne l'identifiant et l'adresse, jamais la cle. Il faut donc la demander
 * a Tuya, une fois, puis plus jamais : ni l'allumage, ni la couleur, ni les
 * scenarios ne repassent par ici.
 *
 * Choix non evident : on emprunte l'enregistrement applicatif PUBLIC de
 * l'integration Home Assistant (`HA_3y9q4ak7g4ephrvke`, schema `haauthorize`).
 * Ce n'est pas un contournement : c'est le mecanisme officiel de partage
 * d'appareils de Tuya, et c'est precisement ce qui evite a l'utilisateur de
 * creer un compte developpeur. L'autorisation reelle, c'est SON scan dans SON
 * application ; ces constantes ne font que designer a quel schema applicatif la
 * connexion se rattache.
 *
 * Le protocole a ete releve dans le SDK Python officiel de Tuya
 * (`tuya-device-sharing-sdk`), pas devine. Deux regimes coexistent :
 *
 *   - la connexion par QR code n'est ni signee ni chiffree ;
 *   - tout le reste est signe (HMAC-SHA256) ET chiffre (AES-128-GCM) avec un
 *     secret derive du jeton de rafraichissement, different a chaque requete.
 *
 * Invariant a preserver : la cle locale ne doit JAMAIS sortir de ce module vers
 * un panneau de configuration. `fetchDevices` la rend au plugin, qui l'ecrit
 * directement dans le registre ; le panneau, lui, n'apprend que des noms.
 *
 * Usage canonique :
 *   const { token, qrContent } = await startQrLogin(userCode);
 *   // ... l'utilisateur scanne, on interroge periodiquement ...
 *   const session = await pollQrLogin(token, userCode);
 *   if (session) for (const d of await fetchDevices(session)) remember(d);
 */
import crypto from 'node:crypto';

/** Enregistrement applicatif public de l'integration Home Assistant. */
const CLIENT_ID = 'HA_3y9q4ak7g4ephrvke';
const SCHEMA = 'haauthorize';

/** Passerelle de connexion. Distincte de l'hote de donnees, rendu a la connexion. */
const LOGIN_HOST = 'https://apigw.iotbing.com';

/**
 * Alphabet du nonce, repris tel quel du SDK.
 *
 * Volontairement ampute des caracteres ambigus (I, l, O, 0, 1, g, q, u, v). On
 * le conserve a l'identique par prudence : rien ne garantit que le serveur ne
 * valide pas la forme du nonce.
 */
const NONCE_ALPHABET = 'ABCDEFGHJKMNPQRSTWXYZabcdefhijkmnprstwxyz2345678';

/** Une session ouverte aupres du cloud, apres scan reussi. */
export type CloudSession = {
  readonly endpoint: string;
  readonly accessToken: string;
  readonly refreshToken: string;
};

/** Une ampoule telle que le cloud la decrit. La cle ne va pas plus loin. */
export type CloudDevice = {
  readonly id: string;
  readonly key: string;
  readonly name: string;
  readonly ip?: string;
  readonly online: boolean;
  readonly category: string;
};

/** Erreur portant le message que Tuya a renvoye, pour l'afficher tel quel. */
export class TuyaCloudError extends Error {}

const nonce = (): string => {
  let out = '';
  for (let i = 0; i < 12; i += 1) {
    out += NONCE_ALPHABET[crypto.randomInt(NONCE_ALPHABET.length)];
  }
  return out;
};

/**
 * Secret de chiffrement d'UNE requete.
 *
 * Derive de l'identifiant de requete et du jeton de rafraichissement : il change
 * donc a chaque appel, et connaitre l'un des deux ne suffit pas.
 */
function secretFor(rid: string, hashKey: string): string {
  return crypto.createHmac('sha256', rid).update(hashKey).digest('hex').slice(0, 16);
}

/**
 * Chiffre une charge utile.
 *
 * Forme de sortie inhabituelle, mais c'est celle du serveur : la base64 du
 * nonce CONCATENEE a la base64 du chiffre. Les deux se separent sans ambiguite,
 * douze octets donnant exactement seize caracteres de base64 sans remplissage.
 */
function encrypt(plain: string, secret: string): string {
  const iv = nonce();
  const cipher = crypto.createCipheriv('aes-128-gcm', Buffer.from(secret, 'utf8'), Buffer.from(iv, 'utf8'));
  const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return Buffer.from(iv, 'utf8').toString('base64') + Buffer.concat([body, cipher.getAuthTag()]).toString('base64');
}

/** Dechiffre une reponse : nonce sur douze octets, puis chiffre et marque. */
function decrypt(payload: string, secret: string): string {
  const raw = Buffer.from(payload, 'base64');
  const decipher = crypto.createDecipheriv('aes-128-gcm', Buffer.from(secret, 'utf8'), raw.subarray(0, 12));
  const marque = raw.subarray(raw.length - 16);
  decipher.setAuthTag(marque);
  return decipher.update(raw.subarray(12, raw.length - 16)).toString('utf8') + decipher.final('utf8');
}

/** Signature d'une requete : en-tetes ordonnes, puis charges chiffrees. */
function sign(hashKey: string, query: string, body: string, headers: Record<string, string>): string {
  const ordre = ['X-appKey', 'X-requestId', 'X-sid', 'X-time', 'X-token'];
  const partie = ordre
    .filter((nom) => headers[nom])
    .map((nom) => nom + '=' + headers[nom])
    .join('||');
  return crypto.createHmac('sha256', hashKey).update(partie + query + body).digest('hex');
}

/** Appel signe et chiffre. Rend la charge utile deja dechiffree. */
async function call(session: CloudSession, path: string, params?: Record<string, string>): Promise<unknown> {
  const rid = crypto.randomUUID();
  const hashKey = crypto.createHash('md5').update(rid + session.refreshToken).digest('hex');
  const secret = secretFor(rid, hashKey);

  const query = params && Object.keys(params).length > 0
    ? encrypt(JSON.stringify(params), secret)
    : '';

  const headers: Record<string, string> = {
    'X-appKey': CLIENT_ID,
    'X-requestId': rid,
    'X-sid': '',
    'X-time': String(Date.now()),
    'X-token': session.accessToken,
  };
  headers['X-sign'] = sign(hashKey, query, '', headers);

  const url = new URL(session.endpoint + path);
  if (query) url.searchParams.set('encdata', query);

  const reponse = await fetch(url, { method: 'GET', headers });
  if (!reponse.ok) throw new TuyaCloudError('Le serveur Tuya a repondu ' + reponse.status);

  const json = (await reponse.json()) as { success?: boolean; code?: number; msg?: string; result?: string };
  if (!json.success) throw new TuyaCloudError(json.msg ?? 'Appel refuse par Tuya (' + json.code + ')');

  return JSON.parse(decrypt(json.result ?? '', secret));
}

/**
 * Demande un jeton de connexion et le contenu du QR code a afficher.
 *
 * Le code utilisateur se lit dans l'application du fabricant, rubrique compte
 * et securite. Il ne suffit pas a se connecter : il designe le compte, le scan
 * l'autorise.
 */
export async function startQrLogin(userCode: string): Promise<{ token: string; qrContent: string }> {
  const url = LOGIN_HOST + '/v1.0/m/life/home-assistant/qrcode/tokens'
    + '?clientid=' + encodeURIComponent(CLIENT_ID)
    + '&usercode=' + encodeURIComponent(userCode)
    + '&schema=' + encodeURIComponent(SCHEMA);

  const reponse = await fetch(url, { method: 'POST' });
  const json = (await reponse.json()) as { success?: boolean; msg?: string; result?: { qrcode?: string } };
  if (!json.success || !json.result?.qrcode) {
    throw new TuyaCloudError(json.msg ?? 'Code utilisateur refuse par Tuya');
  }
  // « smartlife » plutot que « tuyaSmart » : c'est le schema des applications
  // rebadgees, dont Calex Smart fait partie.
  return { token: json.result.qrcode, qrContent: 'smartlife--qrLogin?token=' + json.result.qrcode };
}

/**
 * Interroge une fois l'etat du scan.
 *
 * Rend null tant que l'utilisateur n'a pas confirme — ce n'est pas une erreur,
 * c'est l'etat normal pendant qu'il sort son telephone.
 */
export async function pollQrLogin(token: string, userCode: string): Promise<CloudSession | null> {
  const url = LOGIN_HOST + '/v1.0/m/life/home-assistant/qrcode/tokens/' + encodeURIComponent(token)
    + '?clientid=' + encodeURIComponent(CLIENT_ID)
    + '&usercode=' + encodeURIComponent(userCode);

  const reponse = await fetch(url);
  const json = (await reponse.json()) as {
    success?: boolean;
    result?: { endpoint?: string; end_point?: string; access_token?: string; refresh_token?: string };
  };
  if (!json.success || !json.result?.access_token) return null;

  const { endpoint, end_point: endPoint, access_token: acces, refresh_token: rafraichi } = json.result;
  return {
    endpoint: (endpoint ?? endPoint ?? '').replace(/\/$/, ''),
    accessToken: acces ?? '',
    refreshToken: rafraichi ?? '',
  };
}

/** Les ampoules de tous les foyers du compte, cles comprises. */
export async function fetchDevices(session: CloudSession): Promise<CloudDevice[]> {
  const foyers = (await call(session, '/v1.0/m/life/users/homes')) as { ownerId?: string | number }[];

  const trouvees: CloudDevice[] = [];
  for (const foyer of foyers) {
    if (foyer.ownerId === undefined) continue;
    const appareils = (await call(session, '/v1.0/m/life/ha/home/devices', {
      homeId: String(foyer.ownerId),
    })) as Record<string, unknown>[];

    for (const a of appareils) {
      const id = typeof a.id === 'string' ? a.id : '';
      const key = typeof a.local_key === 'string' ? a.local_key : '';
      if (!id || !key) continue;
      trouvees.push({
        id,
        key,
        name: typeof a.name === 'string' ? a.name : '',
        ...(typeof a.ip === 'string' && a.ip ? { ip: a.ip } : {}),
        online: a.online === true,
        category: typeof a.category === 'string' ? a.category : '',
      });
    }
  }
  return trouvees;
}

/**
 * Interne, expose pour les tests.
 *
 * Ces fonctions reimplementent un protocole releve ailleurs : les verifier vaut
 * mieux que de les croire. Elles ne font pas partie de l'API du module.
 */
export const __test = { secretFor, sign, encrypt, decrypt };
