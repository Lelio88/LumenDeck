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
import fs from 'node:fs';
import path from 'node:path';

import QRCode from 'qrcode';

import { scenarioName } from './i18n.js';
import { SCENARIOS } from './scenarios/catalogue.js';
import streamDeck from '@elgato/streamdeck';

import * as bulbs from './bulbs.js';
import { discover, sweep } from './discovery.js';
import * as pool from './driver/pool.js';
import { TuyaLanDriver } from './driver/tuya.js';
import { fetchDevices, pollQrLogin, startQrLogin, TuyaCloudError } from './tuya-cloud.js';

/** Duree d'ecoute du reseau. Les annonces Tuya tombent toutes les ~5 s. */
const SCAN_MS = 6000;

/**
 * Categories Tuya que ce plugin sait piloter.
 *
 * Un compte contient souvent des prises, des capteurs, des telecommandes : les
 * proposer dans une liste d'ampoules ne ferait qu'egarer. On retient les
 * familles d'eclairage, et on dit combien d'appareils ont ete ecartes plutot
 * que de les taire.
 */
const CATEGORIES_ECLAIRAGE = new Set(['dj', 'dc', 'dd', 'xdd', 'fwd', 'tgq', 'tyndj', 'gyd']);

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
 * Tente de reconnaitre l'appareil situe a une adresse, parmi les ampoules connues.
 *
 * Le balayage ne rapporte que des adresses. Pour leur redonner un nom, on essaie
 * de s'y connecter avec chaque cle connue : seule la bonne aboutit. C'est ce qui
 * permet de retrouver une ampoule dont l'adresse a change sans rien redemander.
 *
 * La connexion mise en cache est liberee d'abord : elle pointerait sur l'ancienne
 * adresse, et une ampoule Tuya n'accepte qu'une poignee de connexions.
 */
async function identify(ip: string, known: bulbs.KnownBulb[]): Promise<bulbs.KnownBulb | null> {
  for (const candidate of known) {
    if (!candidate.key) continue;
    await pool.release(candidate.id);
    try {
      const driver = await TuyaLanDriver.connect({
        id: candidate.id,
        key: candidate.key,
        ip,
        ...(candidate.version ? { version: candidate.version } : {}),
      });
      await driver.read();
      await driver.close();
      return candidate;
    } catch {
      // Pas celle-ci : mauvaise cle, ou mauvais identifiant pour cette adresse.
    }
  }
  return null;
}

/**
 * Cherche des ampoules, par ecoute puis par balayage.
 *
 * DEUX METHODES, dans cet ordre. L'ecoute des annonces est la meilleure : elle
 * rapporte l'identifiant, donc reconnait une ampoule jamais vue. Mais elle
 * echoue des que les diffusions n'atteignent pas la machine — cas frequent d'un
 * ordinateur en filaire face a une ampoule en wifi, beaucoup de box ne relayant
 * pas le trafic diffuse entre les deux.
 *
 * Le balayage prend alors le relais : il frappe a chaque adresse du reseau en
 * unicast, ce qui passe toujours. Il ne rapporte que des adresses, mais
 * `identify` leur redonne un nom quand l'ampoule est deja connue.
 *
 * Chaque resultat dit s'il est deja enregistre, pour que le panneau distingue
 * « nouvelle ampoule a configurer » de « celle-ci est deja la ».
 */
async function sendDiscovery(): Promise<void> {
  const known = await bulbs.list();
  const configured = new Set(known.filter((b) => b.key).map((b) => b.id));

  const heard = await discover(SCAN_MS);
  if (heard.length > 0) {
    // Rafraichir adresse ET version des ampoules DEJA connues. `remember`
    // fusionne, donc la cle deja saisie survit. C'est ce qui permet a une
    // ampoule mise a jour vers le protocole 3.4 de continuer a repondre sans
    // que l'utilisateur ait quoi que ce soit a refaire.
    for (const bulb of heard) {
      if (configured.has(bulb.id)) await bulbs.remember({ id: bulb.id, ip: bulb.ip, version: bulb.version });
    }

    await reply({
      event: 'discoverBulbs',
      method: 'annonces',
      items: heard.map((b) => ({ id: b.id, ip: b.ip, version: b.version, known: configured.has(b.id) })),
    });
    return;
  }

  const addresses = await sweep();
  const items = [];
  for (const ip of addresses) {
    const match = await identify(ip, known);
    items.push(
      match
        ? { id: match.id, ip, version: match.version ?? null, known: true }
        : { id: null, ip, version: null, known: false },
    );
  }

  await reply({ event: 'discoverBulbs', method: 'balayage', items });
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
        case 'getLocale': {
          // Le panneau ne lit PAS les fichiers lui-meme : la resolution d'un
          // chemin relatif depuis sa page depend de la facon dont Stream Deck
          // la sert, ce qui s'est revele instable d'une installation a l'autre.
          // Le plugin, lui, sait ou il vit.
          //
          // La langue du systeme l'emporte quand nous la traduisons — c'est ce
          // qui permet a l'italien d'exister, alors que Stream Deck ne le
          // propose pas ; sinon on suit la langue de Stream Deck.
          // La langue de STREAM DECK fait foi, pas celle du panneau. Releve en
          // conditions reelles : le webview annonce « en » alors que
          // l'application tourne en francais, et un panneau anglais dans une
          // application francaise est pire qu'un panneau non traduit.
          //
          // L'indice du panneau ne sert donc qu'aux langues que Stream Deck ne
          // sait PAS exprimer — l'italien, absent de ses huit langues. Sans
          // cette exception, it.json ne servirait jamais a rien.
          const HORS_STREAM_DECK = new Set(['it']);
          const indice = text(request.hint) ?? '';
          const candidats = HORS_STREAM_DECK.has(indice)
            ? [indice, streamDeck.i18n.language, 'en']
            : [streamDeck.i18n.language, indice, 'en'];
          for (const langue of candidats) {
            if (!/^[a-zA-Z_]{2,5}$/.test(langue)) continue;
            const fichier = path.join(process.cwd(), langue + '.json');
            if (!fs.existsSync(fichier)) continue;
            const contenu = JSON.parse(fs.readFileSync(fichier, 'utf8')) as { Localization?: unknown };
            await reply({ event: 'getLocale', language: langue, dictionary: contenu.Localization ?? {} });
            break;
          }
          break;
        }

        case 'tuyaLoginStart': {
          const code = text(request.userCode);
          if (!code) { await reply({ event: 'tuyaLoginStart', ok: false, message: 'Code utilisateur manquant.' }); break; }
          try {
            const { token, qrContent } = await startQrLogin(code);
            // Le QR part en image, pas en texte : le panneau n'a pas a savoir
            // encoder un QR code, et le contenu ne sert a rien d'autre.
            const qr = await QRCode.toDataURL(qrContent, { margin: 1, width: 240 });
            await reply({ event: 'tuyaLoginStart', ok: true, token, qr });
          } catch (error: unknown) {
            const message = error instanceof TuyaCloudError ? error.message : 'Connexion a Tuya impossible.';
            await reply({ event: 'tuyaLoginStart', ok: false, message });
          }
          break;
        }

        case 'tuyaLoginPoll': {
          const token = text(request.token);
          const code = text(request.userCode);
          if (!token || !code) { await reply({ event: 'tuyaLoginPoll', ok: false, done: false }); break; }
          try {
            const session = await pollQrLogin(token, code);
            // Pas encore scanne : ce n'est pas une erreur, c'est l'attente.
            if (!session) { await reply({ event: 'tuyaLoginPoll', ok: true, done: false }); break; }

            const tous = await fetchDevices(session);
            const lampes = tous.filter((d) => CATEGORIES_ECLAIRAGE.has(d.category));
            for (const lampe of lampes) {
              await bulbs.remember({
                id: lampe.id,
                key: lampe.key,
                ...(lampe.ip ? { ip: lampe.ip } : {}),
                ...(lampe.name ? { name: lampe.name } : {}),
              });
            }
            // Seuls des NOMS repartent vers le panneau. La cle vient d'entrer
            // dans le registre et n'en ressortira jamais.
            await reply({
              event: 'tuyaLoginPoll',
              ok: true,
              done: true,
              names: lampes.map((l) => l.name || l.id.slice(-6)),
              ignored: tous.length - lampes.length,
            });
            await sendBulbList();
          } catch (error: unknown) {
            const message = error instanceof TuyaCloudError ? error.message : 'Recuperation des ampoules impossible.';
            await reply({ event: 'tuyaLoginPoll', ok: false, done: false, message });
          }
          break;
        }

        case 'getScenarios':
          await reply({
            event: 'getScenarios',
            items: SCENARIOS.map((sc) => ({ label: scenarioName(sc.id), value: sc.id })),
          });
          break;

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
            ...(text(request.version) ? { version: text(request.version) as string } : {}),
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
