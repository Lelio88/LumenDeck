/**
 * Action « Twitch » : le tableau de bord des points de chaine.
 *
 * Ce que fait ce module : montrer si les viewers peuvent agir sur les lampes, et
 * permettre de les mettre en pause d'un appui.
 *
 * Choix non evidents :
 *
 *   - La connexion au compte et le choix des ampoules sont GLOBAUX (une seule
 *     recompense, un seul compte) mais un panneau ne se rattache qu'a une
 *     action : c'est la raison d'etre d'une touche dediee, plutot que de loger
 *     Twitch dans le panneau d'une touche Couleur.
 *
 *   - Un appui met en pause ou reactive, et RIEN D'AUTRE. Pendant la pause,
 *     chaque rachat est rembourse : le streamer coupe la main aux viewers
 *     (moment calme, scene sensible) sans toucher a Twitch.
 *
 *   - Toutes les touches Twitch affichees se repeignent ensemble quand l'etat
 *     change : il n'y a qu'un seul service, donc qu'un seul etat a montrer.
 *
 *   - Le choix des ampoules est transmis au service a chaque apparition et a
 *     chaque changement de reglage. Le service le CONSERVE : une touche sur une
 *     page non affichee n'emet aucun evenement, et ne doit pas rendre les
 *     viewers muets.
 *
 * Une touche, pas de molette : la pause est un geste binaire, et la molette
 * n'aurait ni sens ni ecran utile ici.
 */
import { action, SingletonAction } from '@elgato/streamdeck';
import type { DidReceiveSettingsEvent, KeyDownEvent, WillAppearEvent, WillDisappearEvent } from '@elgato/streamdeck';

import { t } from '../i18n.js';
import { asImage, twitchKey } from '../key-art.js';
import type { BulbSettings } from '../settings.js';
import { twitchFace } from '../twitch/face.js';
import * as twitch from '../twitch/service.js';
import { selectedIds } from './group.js';

type Face = {
  readonly id: string;
  setImage(image?: string): Promise<void>;
  setTitle(title: string): Promise<void>;
  showAlert(): Promise<void>;
};

/** Touches Twitch actuellement affichees, par identifiant d'instance. */
const visible = new Map<string, Face>();
let following: (() => void) | undefined;

async function paint(face: Face, status: twitch.Status): Promise<void> {
  const { mode, wordKey } = twitchFace(status.link, status.paused);
  await face.setImage(asImage(twitchKey(mode, wordKey ? t(wordKey) : '')));
  // Le mot est dans l'image : un titre par dessus le doublerait.
  await face.setTitle('');
}

async function paintAll(status: twitch.Status): Promise<void> {
  await Promise.all([...visible.values()].map((face) => paint(face, status).catch(() => undefined)));
}

@action({ UUID: 'com.lumendeck.bulb.twitch' })
export class TwitchAction extends SingletonAction<BulbSettings> {
  override async onWillAppear(ev: WillAppearEvent<BulbSettings>): Promise<void> {
    const face = ev.action as unknown as Face;
    visible.set(face.id, face);
    // Un seul abonnement pour toutes les touches : il se cree avec la premiere.
    following ??= twitch.onStatus((status) => { void paintAll(status); });

    await twitch.setBulbs(selectedIds(ev.payload.settings));
    await paint(face, twitch.getStatus());
  }

  override onWillDisappear(ev: WillDisappearEvent<BulbSettings>): void {
    visible.delete(ev.action.id);
  }

  override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<BulbSettings>): Promise<void> {
    await twitch.setBulbs(selectedIds(ev.payload.settings));
  }

  override async onKeyDown(ev: KeyDownEvent<BulbSettings>): Promise<void> {
    const status = twitch.getStatus();
    // Pas de pause sans liaison : l'appui n'aurait rien a mettre en pause, et un
    // faux « Pause » ferait croire que les viewers sont coupes alors qu'ils ne
    // sont pas connectes. Le clignotement renvoie vers le panneau.
    if (status.link !== 'online' && !status.paused) { await ev.action.showAlert(); return; }
    await twitch.togglePaused();
  }
}
