/**
 * Action « intensite lumineuse ».
 *
 * Sur une touche : chaque appui applique un pas (+10 % par defaut ; un pas
 * negatif fait une touche « baisser »). Sur une molette du Stream Deck+ : la
 * rotation regle en continu, l'appui bascule l'ampoule, et l'ecran affiche le
 * pourcentage reel.
 *
 * Choix non evident : le pilote route lui-meme l'intensite vers le bon reglage
 * selon le mode de l'ampoule (voir driver/tuya.ts). Cette action ignore donc
 * tout des modes — elle demande « 40 % » et fait confiance. C'est exactement ce
 * qui evite la molette qui « ne fait rien » des que l'ampoule est en couleur.
 */
import { action, SingletonAction } from '@elgato/streamdeck';
import type { DialDownEvent, DialRotateEvent, DidReceiveSettingsEvent, KeyDownEvent, WillAppearEvent, WillDisappearEvent } from '@elgato/streamdeck';
import { t } from '../i18n.js';
import { asImage, brightnessKey } from '../key-art.js';
import { withRetry } from '../driver/pool.js';
import { coordinatesFor } from '../bulbs.js';
import { reportFailure } from './failure.js';
import { cancelRecovery } from './recovery.js';
import type { BrightnessSettings } from '../settings.js';

/** Pas par defaut, en points de pourcentage. */
const DEFAULT_STEP = 10;

/** Surface commune aux touches et aux molettes ; setFeedback n'existe que sur ces dernieres. */
type Paintable = {
  /** Identifiant d'instance de la touche, cle du cycle de reprise. */
  readonly id: string;
  setTitle(title: string): Promise<void>;
  showAlert(): Promise<void>;
  /** Remplace l'image de la touche. `undefined` restaure celle du manifeste. */
  setImage?: (image?: string) => Promise<void>;
  /** N'existe que sur une molette : l'ecran du Stream Deck+. */
  setFeedback?: (payload: Record<string, unknown>) => Promise<void>;
};

/**
 * Ramene la touche a son apparence de repos, avec un mot d'explication.
 *
 * Efface l'image dessinee : sans cela, une touche qui perd son ampoule
 * continuerait d'afficher la derniere valeur connue, ce qui est pire que rien.
 */
async function reset(target: Paintable, label: string): Promise<void> {
  await target.setImage?.(undefined);
  await target.setTitle(label);
}

@action({ UUID: 'com.lumendeck.bulb.brightness' })
export class Brightness extends SingletonAction<BrightnessSettings> {
  /**
   * La touche quitte l'ecran : on coupe son cycle de reprise.
   *
   * Sans cela, une page qu'on quitte laisserait une relecture programmee
   * interroger l'ampoule pour repeindre un ecran que plus personne ne regarde,
   * en consommant au passage une des rares connexions qu'elle accepte.
   */
  override onWillDisappear(ev: WillDisappearEvent<BrightnessSettings>): void {
    cancelRecovery(ev.action.id);
  }

  override async onWillAppear(ev: WillAppearEvent<BrightnessSettings>): Promise<void> {
    await this.refresh(ev.action as unknown as Paintable, ev.payload.settings);
  }

  /** Un reglage a change : la touche peut viser une autre ampoule. */
  override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<BrightnessSettings>): Promise<void> {
    await this.refresh(ev.action as unknown as Paintable, ev.payload.settings);
  }

  /** Lit l'ampoule et reporte son etat REEL, jamais un etat suppose. */
  private async refresh(target: Paintable, settings: BrightnessSettings): Promise<void> {
    const coords = await coordinatesFor(settings);
    if (!coords) { await reset(target, t('key.toSet')); return; }
    try {
      const state = await withRetry(coords, (bulb) => bulb.read());
      await paint(target, state.brightness, state.on);
    } catch (error) {
      await reportFailure(target, error, { where: 'brightness.refresh', deviceId: coords.id, recover: () => this.refresh(target, settings) });
    }
  }

  override async onKeyDown(ev: KeyDownEvent<BrightnessSettings>): Promise<void> {
    const step = ev.payload.settings.step ?? DEFAULT_STEP;
    await this.nudge(ev.action as unknown as Paintable, ev.payload.settings, step);
  }

  /** Un cran de molette vaut un pas ; une rotation rapide en cumule plusieurs. */
  override async onDialRotate(ev: DialRotateEvent<BrightnessSettings>): Promise<void> {
    const step = Math.abs(ev.payload.settings.step ?? DEFAULT_STEP);
    await this.nudge(ev.action as unknown as Paintable, ev.payload.settings, ev.payload.ticks * step);
  }

  override async onDialDown(ev: DialDownEvent<BrightnessSettings>): Promise<void> {
    const target = ev.action as unknown as Paintable;
    const { settings } = ev.payload;
    const coords = await coordinatesFor(settings);
    if (!coords) { await reset(target, t('key.toSet')); return; }
    try {
      const state = await withRetry(coords, async (bulb) => {
        await bulb.togglePower();
        return bulb.read();
      });
      await paint(target, state.brightness, state.on);
    } catch (error) {
      await reportFailure(target, error, { where: 'brightness.toggle', deviceId: coords.id, alert: true, recover: () => this.refresh(target, settings) });
    }
  }

  private async nudge(target: Paintable, settings: BrightnessSettings, delta: number): Promise<void> {
    const coords = await coordinatesFor(settings);
    if (!coords) { await reset(target, t('key.toSet')); return; }
    try {
      const level = await withRetry(coords, (bulb) => bulb.nudgeBrightness(delta));
      await paint(target, level, true);
    } catch (error) {
      await reportFailure(target, error, { where: 'brightness.nudge', deviceId: coords.id, alert: true, recover: () => this.refresh(target, settings) });
    }
  }
}

/** Ecrit sur la touche, et sur l'ecran de la molette quand il y en a un. */
async function paint(target: Paintable, percent: number, on: boolean): Promise<void> {
  // L'image PORTE la valeur : une jauge qui se remplit, avec le pourcentage
  // dessine dedans. Le titre ferait doublon, et Stream Deck l'ecrirait par
  // dessus le dessin.
  await target.setImage?.(asImage(brightnessKey(percent, on, t('key.off'))));
  await target.setTitle('');
  if (typeof target.setFeedback === 'function') {
    const label = on ? String(percent) + ' %' : t('key.off');
    await target.setFeedback({ title: t('dial.brightness'), value: label, indicator: on ? percent : 0 });
  }
}
