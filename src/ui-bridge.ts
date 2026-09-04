/**
 * Pont entre les panneaux de configuration et le plugin.
 *
 * Ce que fait ce module : repondre aux quatre demandes que les panneaux savent
 * formuler — lister les ampoules connues, en chercher sur le reseau, en
 * enregistrer une, en oublier une.
 *
 * Protocole, releve dans le code de sdpi-components et non suppose : un
 * composant portant l'attribut `datasource="x"` emet vers le plugin
 * `{ event: "x" }` (avec `isRefresh: true` sur les rafraichissements), et attend
 * en retour un message dont la charge utile vaut `{ event: "x", items: [...] }`.
 * Les evenements personnalises suivent la meme forme, pour n'avoir qu'une seule
 * convention a retenir.
 *
 * Invariant de securite : la cle locale entre par ici mais n'en ressort JAMAIS.
 * Les listes renvoyees au panneau ne contiennent qu'un identifiant, une adresse
 * et un libelle. Un panneau est une page web ; lui renvoyer un secret qu'il a
 * deja n'apporte rien et multiplie les endroits ou il peut fuir.
 *
 * Usage canonique : appeler installUiBridge() une fois, depuis plugin.ts.
 */
import streamDeck from '@elgato/streamdeck';

import * as bulbs from './bulbs.js';
import { discover } from './discovery.js';

/** Duree d'ecoute du reseau. Les annonces Tuya tombent toutes les ~5 s. */
const SCAN_MS = 6000;

/** Une demande venue d'un panneau. Le champ `event` est le seul garanti. */
type Request = { event: string } & Record<string, unknown>;

function asRequest(payload: unknown): Request | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const event = (payload as Record<string, unknown>).event;
  return typeof event === 'string' ? ({ ...(payload as Record<string, unknown>), event } as Request) : null;
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

/**
 * Repond au panneau actuellement visible.
 *
 * Le SDK n'envoie que si un panneau de CE plugin est affiche ; inutile donc de
 * verifier soi-meme qu'il y a quelqu'un a l'ecoute.
 */
async function reply(payload: Record<string, unknown>): Promise<void> {
  await streamDeck.ui.sendToPropertyInspector(payload as never);
}

/** Liste destinee au selecteur d'ampoule. Ne divulgue aucune cle. */
async function sendBulbList(): Promise<void> {
  const known = await bulbs.list();
  await reply({
    event: 'getBulbs',
    items: known.map((b) => ({ label: bulbs.label(b), value: b.id })),
  });
}

/**
 * Cherche des ampoules sur le reseau et renvoie ce qui a ete trouve.
 *
 * Chaque resultat indique s'il est DEJA connu : le panneau peut ainsi distinguer
 * « nouvelle ampoule a configurer » de « celle-ci est deja enregistree », au lieu
 * d'afficher une liste indifferenciee.
 */
async function sendDiscovery(): Promise<void> {
  const [found, known] = await Promise.all([discover(SCAN_MS), bulbs.list()]);
  const configured = new Set(known.filter((b) => b.key).map((b) => b.id));

  await reply({
    event: 'discoverBulbs',
    items: found.map((b) => ({
      id: b.id,
      ip: b.ip,
      version: b.version,
      known: configured.has(b.id),
    })),
  });
}

/**
 * Installe le pont. A appeler une fois au demarrage du plugin.
 *
 * Les erreurs sont renvoyees au panneau plutot que journalisees : c'est la seule
 * facon pour l'utilisateur de comprendre pourquoi sa recherche n'a rien donne,
 * et un journal qu'il n'ouvrira jamais ne l'aiderait pas.
 */
export function installUiBridge(): void {
  streamDeck.ui.onSendToPlugin(async (ev) => {
    const request = asRequest(ev.payload);
    if (!request) return;

    try {
      switch (request.event) {
        case 'getBulbs':
          await sendBulbList();
          break;

        case 'discoverBulbs':
          await sendDiscovery();
          break;

        case 'saveBulb': {
          const id = text(request.id);
          if (!id) { await reply({ event: 'saveBulb', ok: false, message: 'Identifiant manquant.' }); break; }
          await bulbs.remember({
            id,
            ...(text(request.key) ? { key: text(request.key) as string } : {}),
            ...(text(request.ip) ? { ip: text(request.ip) as string } : {}),
            ...(text(request.name) ? { name: text(request.name) as string } : {}),
          });
          await reply({ event: 'saveBulb', ok: true, id });
          await sendBulbList();
          break;
        }

        case 'forgetBulb': {
          const id = text(request.id);
          if (id) await bulbs.forget(id);
          await reply({ event: 'forgetBulb', ok: true });
          await sendBulbList();
          break;
        }
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Erreur inattendue.';
      await reply({ event: request.event, ok: false, message });
    }
  });
}
