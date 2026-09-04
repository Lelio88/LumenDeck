/**
 * Action « temperature de blanc ».
 *
 * Sur une touche : chaque appui applique la temperature choisie dans le panneau
 * de reglages. Sur une molette du Stream Deck+ : la rotation la fait varier en
 * continu du blanc chaud au blanc froid, l'appui bascule l'ampoule.
 *
 * Choix non evident : appliquer une temperature fait BASCULER l'ampoule en mode
 * blanc — c'est l'ampoule elle-meme qui l'impose, ecrire sa temperature suffit a
 * lui faire quitter le mode couleur. Ce n'est donc pas une decision du plugin,
 * mais un comportement materiel qu'il faut connaitre : une touche « couleur » et
 * une touche « temperature » s'excluent mutuellement, par construction.
 *
 * La rotation part de la temperature REELLE de l'ampoule, pas de celle
 * configuree : sinon chaque cran ramenerait au point de depart au lieu de
 * poursuivre le reglage en cours.
 */
import { action, SingletonAction } from '@elgato/streamdeck';
import type { DialDownEvent, DialRotateEvent, DidReceiveSettingsEvent, KeyDownEvent, WillAppearEvent } from '@elgato/streamdeck';

import { temperatureKey } from '../key-art.js';
import { withRetry } from '../driver/pool.js';
import { coordinatesFor } from '../bulbs.js';
import type { TemperatureSettings } from '../settings.js';

/** Plage atteignable par les ampoules Calex a blanc reglable. */
const KELVIN_MIN = 2700;
const KELVIN_MAX = 6500;
/** Blanc neutre, valeur de depart raisonnable. */
const DEFAULT_KELVIN = 4000;
/** Kelvins par cran de molette. */
const DEFAULT_STEP = 200;

type Paintable = {
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

const clamp = (n: number) => Math.min(KELVIN_MAX, Math.max(KELVIN_MIN, n));

/** Qualifie une temperature, pour que la touche dise plus qu'un nombre. */
function warmth(kelvin: number): string {
  if (kelvin < 3200) return 'Chaud';
  if (kelvin < 4600) return 'Neutre';
  if (kelvin < 5600) return 'Froid';
  return 'Lumiere du jour';
}

@action({ UUID: 'com.lumendeck.bulb.temperature' })
export class Temperature extends SingletonAction<TemperatureSettings> {
  override async onWillAppear(ev: WillAppearEvent<TemperatureSettings>): Promise<void> {
    const target = ev.action as unknown as Paintable;
    const { settings } = ev.payload;
    const coords = await coordinatesFor(settings);
    if (!coords) { await reset(target, 'A regler'); return; }
    try {
      // Idem : l'etat reel prime sur le reglage memorise.
      const state = await withRetry(coords, (bulb) => bulb.read());
      await paint(target, state.temperatureK ?? clamp(settings.kelvin ?? DEFAULT_KELVIN), state.on);
    } catch {
      await reset(target, 'Hors ligne');
    }
  }

  /** Le curseur bouge dans le panneau : le disque se teinte aussitot. */
  override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<TemperatureSettings>): Promise<void> {
    const target = ev.action as unknown as Paintable;
    const { settings } = ev.payload;
    if (!(await coordinatesFor(settings))) { await reset(target, 'A regler'); return; }
    await paint(target, clamp(settings.kelvin ?? DEFAULT_KELVIN), true);
  }

  override async onKeyDown(ev: KeyDownEvent<TemperatureSettings>): Promise<void> {
    const target = ev.action as unknown as Paintable;
    const { settings } = ev.payload;
    const coords = await coordinatesFor(settings);
    if (!coords) { await reset(target, 'A regler'); return; }

    const wanted = clamp(settings.kelvin ?? DEFAULT_KELVIN);
    try {
      await withRetry(coords, async (bulb) => {
        // Allumer d'abord : regler une ampoule eteinte ne produit rien de
        // visible, et la touche passerait pour cassee.
        await bulb.setPower(true);
        await bulb.setTemperature(wanted);
      });
      await paint(target, wanted);
    } catch {
      await target.showAlert();
    }
  }

  override async onDialRotate(ev: DialRotateEvent<TemperatureSettings>): Promise<void> {
    const target = ev.action as unknown as Paintable;
    const { settings } = ev.payload;
    const coords = await coordinatesFor(settings);
    if (!coords) { await reset(target, 'A regler'); return; }

    const step = Math.abs(settings.step ?? DEFAULT_STEP);
    try {
      const applied = await withRetry(coords, async (bulb) => {
        const state = await bulb.read();
        const base = state.temperatureK ?? clamp(settings.kelvin ?? DEFAULT_KELVIN);
        const next = clamp(base + ev.payload.ticks * step);
        await bulb.setTemperature(next);
        return next;
      });
      await paint(target, applied);
    } catch {
      await target.showAlert();
    }
  }

  override async onDialDown(ev: DialDownEvent<TemperatureSettings>): Promise<void> {
    const target = ev.action as unknown as Paintable;
    const { settings } = ev.payload;
    const coords = await coordinatesFor(settings);
    if (!coords) return;
    try {
      const on = await withRetry(coords, (bulb) => bulb.togglePower());
      await paint(target, clamp(settings.kelvin ?? DEFAULT_KELVIN), on);
    } catch {
      await target.showAlert();
    }
  }
}

async function paint(target: Paintable, kelvin: number, on: boolean = true): Promise<void> {
  // Le demi-disque prend la teinte reelle du blanc demande : on VOIT la chaleur.
  // Le nombre reste dessine dedans, parce que 3800 et 4200 K se ressemblent
  // beaucoup a l'oeil alors qu'ils ne se choisissent pas au hasard.
  await target.setImage?.(temperatureKey(kelvin, on));
  await target.setTitle('');
  if (typeof target.setFeedback === 'function') {
    const pct = Math.round(((kelvin - KELVIN_MIN) / (KELVIN_MAX - KELVIN_MIN)) * 100);
    await target.setFeedback({ title: warmth(kelvin), value: String(kelvin) + ' K', indicator: pct });
  }
}
