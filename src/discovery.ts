/**
 * Decouverte des ampoules Tuya presentes sur le reseau local.
 *
 * Ce que fait ce module : ecouter les annonces que les appareils Tuya diffusent
 * spontanement, et en tirer leur identifiant, leur adresse et leur version de
 * protocole. Il ne se connecte a rien et n'envoie rien : il ecoute.
 *
 * Pourquoi ca marche sans aucun secret : tout appareil Tuya diffuse sa presence
 * en UDP toutes les cinq secondes environ. Sur le port 6666 en clair (protocole
 * 3.1), sur le 6667 chiffre par une cle UNIVERSELLE (3.3 et suivants) — cle
 * publique, identique pour tous les appareils du monde, qui ne protege rien et
 * ne permet que de lire l'annonce. Elle ne donne AUCUN acces a l'appareil : pour
 * lui parler, il faut sa cle locale, propre a lui et absente de l'annonce.
 *
 * C'est precisement la limite de ce module, et elle est structurelle : la
 * decouverte trouve l'identifiant et l'adresse, jamais la cle. Celle-ci reste a
 * saisir une fois par ampoule (voir docs/configuration.md).
 *
 * Invariant : ce module ne doit jamais bloquer. Il s'arrete tout seul apres le
 * delai imparti, meme si aucune ampoule ne repond.
 *
 * Usage canonique :
 *   const found = await discover(6000);
 */
import dgram from 'node:dgram';
import crypto from 'node:crypto';

/** Cle publique de dechiffrement des annonces, commune a tous les appareils Tuya. */
const BROADCAST_KEY = crypto.createHash('md5').update('yGAdlopoPVldABfn').digest();

/** Ports d'annonce : 6666 en clair, 6667 chiffre. */
const PORTS = [6666, 6667] as const;

/** Duree d'ecoute par defaut. Les annonces tombent toutes les ~5 s. */
const DEFAULT_TIMEOUT_MS = 6000;

/** Une ampoule reperee sur le reseau. La cle locale n'en fait jamais partie. */
export type DiscoveredBulb = {
  /** Identifiant Tuya, tel qu'annonce par l'appareil. */
  readonly id: string;
  /** Adresse sur le reseau local. */
  readonly ip: string;
  /** Version du protocole annoncee, par exemple "3.3". */
  readonly version: string;
  /** Identifiant de produit, utile pour reconnaitre un modele. */
  readonly productKey?: string;
};

function decrypt(payload: Buffer): string | null {
  try {
    const d = crypto.createDecipheriv('aes-128-ecb', BROADCAST_KEY, null);
    d.setAutoPadding(false);
    return Buffer.concat([d.update(payload), d.final()]).toString('utf8');
  } catch {
    return null;
  }
}

function extractJson(text: string | null): Record<string, unknown> | null {
  if (!text) return null;
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Extrait l'annonce d'une trame.
 *
 * L'entete Tuya fait 16 octets, parfois 20 quand un code de retour precede la
 * charge utile ; on essaie les deux plutot que de deviner. La charge est en
 * clair sur le port 6666, chiffree sur le 6667 — on tente le clair d'abord, ce
 * qui evite un dechiffrement inutile.
 */
function parseAnnouncement(msg: Buffer): Record<string, unknown> | null {
  for (const offset of [20, 16]) {
    const body = msg.subarray(offset, msg.length - 8);
    if (body.length === 0) continue;
    const plain = extractJson(body.toString('utf8'));
    if (plain) return plain;
    if (body.length % 16 === 0) {
      const decoded = extractJson(decrypt(body));
      if (decoded) return decoded;
    }
  }
  return null;
}

/**
 * Ecoute les annonces pendant `timeoutMs` et renvoie les ampoules distinctes.
 *
 * Ne rejette jamais sur une erreur de socket : un port deja occupe, ou bloque
 * par un pare-feu, ne doit pas faire echouer la recherche entiere — l'autre port
 * peut tres bien suffire.
 */
export function discover(timeoutMs: number = DEFAULT_TIMEOUT_MS): Promise<DiscoveredBulb[]> {
  return new Promise((resolve) => {
    const found = new Map<string, DiscoveredBulb>();
    const sockets: dgram.Socket[] = [];

    for (const port of PORTS) {
      const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
      socket.on('error', () => { /* port indisponible : l'autre suffira peut-etre */ });
      socket.on('message', (msg, rinfo) => {
        const data = parseAnnouncement(msg);
        const id = typeof data?.gwId === 'string' ? data.gwId
                 : typeof data?.devId === 'string' ? data.devId
                 : null;
        if (!id || found.has(id)) return;
        found.set(id, {
          id,
          ip: typeof data?.ip === 'string' ? data.ip : rinfo.address,
          version: typeof data?.version === 'string' ? data.version : '3.3',
          ...(typeof data?.productKey === 'string' ? { productKey: data.productKey } : {}),
        });
      });
      try {
        socket.bind(port, () => { try { socket.setBroadcast(true); } catch { /* sans importance */ } });
        sockets.push(socket);
      } catch {
        /* impossible d'ecouter ce port : on continue avec l'autre */
      }
    }

    setTimeout(() => {
      for (const socket of sockets) {
        try { socket.close(); } catch { /* deja ferme */ }
      }
      resolve([...found.values()]);
    }, timeoutMs).unref();
  });
}
