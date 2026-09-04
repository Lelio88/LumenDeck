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
import type { DialDownEvent, DialRotateEvent, KeyDownEvent, WillAppearEvent } from '@elgato/streamdeck';
import { withRetry } from '../driver/pool.js';
import { isConfigured, type BrightnessSettings } from '../settings.js';
import { coordinates } from './toggle.js';

/** Pas par defaut, en points de pourcentage. */
const DEFAULT_STEP = 10;

/** Surface commune aux touches et aux molettes ; setFeedback n'existe que sur ces dernieres. */
type Paintable = {
  setTitle(title: string): Promise<void>;
  showAlert(): Promise<void>;
  setFeedback?: (payload: Record<string, unknown>) => Promise<void>;
};

@action({ UUID: 'com.lumendeck.bulb.brightness' })
export class Brightness extends SingletonAction<BrightnessSettings> {
  override async onWillAppear(ev: WillAppearEvent<BrightnessSettings>): Promise<void> {
    const target = ev.action as unknown as Paintable;
    const { settings } = ev.payload;
    if (!isConfigured(settings)) { await target.setTitle('A regler'); return; }
    try {
      const state = await withRetry(coordinates(settings), (bulb) => bulb.read());
      await paint(target, state.brightness, state.on);
    } catch {
      await target.setTitle('Hors ligne');
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
    if (!isConfigured(settings)) { await target.setTitle('A regler'); return; }
    try {
      const state = await withRetry(coordinates(settings), async (bulb) => {
        await bulb.togglePower();
        return bulb.read();
      });
      await paint(target, state.brightness, state.on);
    } catch {
      await target.showAlert();
    }
  }

  private async nudge(target: Paintable, settings: BrightnessSettings, delta: number): Promise<void> {
    if (!isConfigured(settings)) { await target.setTitle('A regler'); return; }
    try {
      const level = await withRetry(coordinates(settings), (bulb) => bulb.nudgeBrightness(delta));
      await paint(target, level, true);
    } catch {
      await target.showAlert();
    }
  }
}

/** Ecrit sur la touche, et sur l'ecran de la molette quand il y en a un. */
async function paint(target: Paintable, percent: number, on: boolean): Promise<void> {
  const label = on ? String(percent) + ' %' : 'Eteinte';
  await target.setTitle(label);
  if (typeof target.setFeedback === 'function') {
    await target.setFeedback({ title: 'Intensite', value: label, indicator: on ? percent : 0 });
  }
}
