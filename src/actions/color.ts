/**
 * Action « couleur ».
 *
 * Sur une touche : chaque appui applique la couleur choisie dans le panneau de
 * reglages. Sur une molette du Stream Deck+ : la rotation fait tourner la teinte
 * en direct, l'appui bascule l'ampoule.
 *
 * Choix non evident : la rotation preserve la SATURATION et la VALEUR courantes
 * de l'ampoule, elle ne fait tourner que la teinte. Reappliquer la couleur
 * configuree a chaque cran ecraserait l'intensite que l'utilisateur vient
 * peut-etre de regler avec la touche voisine — deux touches qui se battent pour
 * le meme etat sont une source de confusion durable.
 *
 * Deuxieme subtilite : si l'ampoule est en mode blanc, elle n'a pas de couleur
 * courante a faire tourner. On repart alors de la couleur configuree, ce qui
 * donne un point de depart previsible plutot qu'un rouge arbitraire.
 */
import { action, SingletonAction } from '@elgato/streamdeck';
import type { DialDownEvent, DialRotateEvent, KeyDownEvent, WillAppearEvent } from '@elgato/streamdeck';

import { hexToHsv, rotateHue } from '../color-format.js';
import { withRetry } from '../driver/pool.js';
import type { Hsv } from '../driver/types.js';
import { coordinates, isConfigured, type ColorSettings } from '../settings.js';

/** Couleur de repli si la touche n'en a pas encore : un blanc chaud neutre. */
const FALLBACK: Hsv = { h: 30, s: 40, v: 100 };
/** Degres de teinte par cran de molette. */
const DEFAULT_STEP = 15;

type Paintable = {
  setTitle(title: string): Promise<void>;
  showAlert(): Promise<void>;
  setFeedback?: (payload: Record<string, unknown>) => Promise<void>;
};

/** Couleur retenue par la touche, ou le repli si elle est absente ou illisible. */
function configured(settings: ColorSettings): Hsv {
  return (settings.color ? hexToHsv(settings.color) : null) ?? FALLBACK;
}

/** Nomme grossierement une teinte, pour que la touche dise autre chose qu'un nombre. */
function hueName(h: number): string {
  const names = [
    [15, 'Rouge'], [45, 'Orange'], [70, 'Jaune'], [160, 'Vert'],
    [200, 'Cyan'], [255, 'Bleu'], [290, 'Violet'], [340, 'Rose'], [361, 'Rouge'],
  ] as const;
  for (const [limit, name] of names) if (h < limit) return name;
  return 'Rouge';
}

@action({ UUID: 'com.lumendeck.bulb.color' })
export class Color extends SingletonAction<ColorSettings> {
  override async onWillAppear(ev: WillAppearEvent<ColorSettings>): Promise<void> {
    const target = ev.action as unknown as Paintable;
    if (!isConfigured(ev.payload.settings)) { await target.setTitle('A regler'); return; }
    await paint(target, configured(ev.payload.settings));
  }

  override async onKeyDown(ev: KeyDownEvent<ColorSettings>): Promise<void> {
    const target = ev.action as unknown as Paintable;
    const { settings } = ev.payload;
    if (!isConfigured(settings)) { await target.setTitle('A regler'); return; }

    const wanted = configured(settings);
    try {
      await withRetry(coordinates(settings), async (bulb) => {
        // Allumer d'abord : appliquer une couleur a une ampoule eteinte est
        // silencieux, et l'utilisateur croirait la touche cassee.
        await bulb.setPower(true);
        await bulb.setColor(wanted);
      });
      await paint(target, wanted);
    } catch {
      await target.showAlert();
    }
  }

  override async onDialRotate(ev: DialRotateEvent<ColorSettings>): Promise<void> {
    const target = ev.action as unknown as Paintable;
    const { settings } = ev.payload;
    if (!isConfigured(settings)) { await target.setTitle('A regler'); return; }

    const step = Math.abs(settings.step ?? DEFAULT_STEP);
    try {
      const applied = await withRetry(coordinates(settings), async (bulb) => {
        const state = await bulb.read();
        const base = state.color ?? configured(settings);
        const next = rotateHue(base, ev.payload.ticks * step);
        await bulb.setColor(next);
        return next;
      });
      await paint(target, applied);
    } catch {
      await target.showAlert();
    }
  }

  override async onDialDown(ev: DialDownEvent<ColorSettings>): Promise<void> {
    const target = ev.action as unknown as Paintable;
    const { settings } = ev.payload;
    if (!isConfigured(settings)) return;
    try {
      const on = await withRetry(coordinates(settings), (bulb) => bulb.togglePower());
      if (!on) { await target.setTitle('Eteinte'); return; }
      await paint(target, configured(settings));
    } catch {
      await target.showAlert();
    }
  }
}

async function paint(target: Paintable, color: Hsv): Promise<void> {
  const label = hueName(color.h);
  await target.setTitle(label);
  if (typeof target.setFeedback === 'function') {
    await target.setFeedback({ title: 'Couleur', value: label, indicator: Math.round((color.h / 360) * 100) });
  }
}
