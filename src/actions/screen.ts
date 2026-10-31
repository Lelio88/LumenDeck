/**
 * Action « ecran ».
 *
 * Un appui fait suivre a la ou aux lampes choisies la couleur de l'ecran ; un
 * second l'arrete et remet les lampes exactement comme elles etaient.
 *
 * Choix non evident, calque sur la touche de scenario : la touche n'entretient
 * AUCUN etat local. Elle demande au moteur si le suivi occupe la lampe visee et
 * se dessine d'apres cette reponse — ce qui la tient d'accord avec la realite
 * quand un scenario ou un rachat Twitch prend la lampe, ou quand le capteur meurt
 * (la fin de session repeint la touche, voir `ended`).
 *
 * Le suivi continue quand la touche quitte l'ecran (changement de profil) : le
 * couper d'office priverait une partie en cours de son ambiance au premier
 * changement de page. Le moteur, lui, coupe tout a l'extinction du plugin.
 */
import { action, SingletonAction } from '@elgato/streamdeck';
import type { DidReceiveSettingsEvent, KeyDownEvent, WillAppearEvent } from '@elgato/streamdeck';

import { adoptBulbs, coordinatesForMany } from '../bulbs.js';
import { t } from '../i18n.js';
import { asImage, screenKey } from '../key-art.js';
import { screenSync } from '../screen/runner.js';
import type { StartResult, SyncEnd } from '../screen/sync.js';
import type { ScreenSettings } from '../settings.js';

type Paintable = {
  setTitle(title: string): Promise<void>;
  showAlert(): Promise<void>;
  setImage?: (image?: string) => Promise<void>;
};

/** Ramene la touche a son apparence de repos, avec un mot d'explication, et la fait clignoter si on le demande. */
async function say(target: Paintable, word: string, alert: boolean): Promise<void> {
  await target.setImage?.(undefined);
  await target.setTitle(word);
  if (alert) await target.showAlert();
}

/** Le mot qui explique pourquoi le suivi ne tourne pas. */
function wordFor(why: StartResult | SyncEnd): string {
  switch (why) {
    case 'unavailable': return t('key.noCapture');
    case 'capture-failed': return t('key.captureLost');
    default: return t('key.offline');
  }
}

@action({ UUID: 'com.lumendeck.bulb.screen' })
export class ScreenAction extends SingletonAction<ScreenSettings> {
  override async onWillAppear(ev: WillAppearEvent<ScreenSettings>): Promise<void> {
    await adoptBulbs(ev.action, ev.payload.settings);
    await this.repaint(ev.action as unknown as Paintable, ev.payload.settings);
  }

  override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<ScreenSettings>): Promise<void> {
    await this.repaint(ev.action as unknown as Paintable, ev.payload.settings);
  }

  override async onKeyDown(ev: KeyDownEvent<ScreenSettings>): Promise<void> {
    await this.toggle(ev.action as unknown as Paintable, ev.payload.settings);
  }

  /** Lance le suivi, ou l'arrete s'il tournait deja. */
  private async toggle(target: Paintable, settings: ScreenSettings): Promise<void> {
    const targets = await coordinatesForMany(settings);
    const primary = targets[0];
    if (!primary) {
      await say(target, t('key.toSet'), false);
      return;
    }

    if (screenSync.isActive(primary.id)) {
      await screenSync.stop(primary.id);
      await this.paint(target, settings);
      return;
    }

    const result = await screenSync.start(
      targets,
      { screen: settings.screen ?? 'primary', mode: settings.mode === 'zones' ? 'zones' : 'same' },
      (why) => { void this.ended(target, settings, why); },
    );
    // Annule (second appui pendant le demarrage) : pas une panne, la touche redit simplement l'etat reel.
    if (result === 'started' || result === 'cancelled') await this.repaint(target, settings);
    else await say(target, wordFor(result), true);
  }

  /** La session s'est terminee, quelle qu'en soit la cause : la touche dit la verite. */
  private async ended(target: Paintable, settings: ScreenSettings, why: SyncEnd): Promise<void> {
    try {
      if (why === 'capture-failed') await say(target, wordFor(why), true);
      else await this.repaint(target, settings);
    } catch {
      // La touche a pu disparaitre (changement de profil) : il n'y a plus rien a dessiner.
    }
  }

  private async repaint(target: Paintable, settings: ScreenSettings): Promise<void> {
    if ((await coordinatesForMany(settings)).length === 0) {
      await say(target, t('key.toSet'), false);
      return;
    }
    await this.paint(target, settings);
  }

  private async paint(target: Paintable, settings: ScreenSettings): Promise<void> {
    const [primary] = await coordinatesForMany(settings);
    const running = screenSync.isActive(primary?.id);
    await target.setImage?.(asImage(screenKey(t('key.screen'), running)));
    await target.setTitle('');
  }
}
