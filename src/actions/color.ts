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

import { hexToHsv, hsvToHex, rotateHue } from '../color-format.js';
import { colorKey } from '../key-art.js';
import { withRetry } from '../driver/pool.js';
import type { Hsv } from '../driver/types.js';
import { coordinatesFor } from '../bulbs.js';
import type { ColorSettings } from '../settings.js';

/** Couleur de repli si la touche n'en a pas encore : un blanc chaud neutre. */
const FALLBACK: Hsv = { h: 30, s: 40, v: 100 };
/** Degres de teinte par cran de molette. */
const DEFAULT_STEP = 15;

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
    const coords = await coordinatesFor(ev.payload.settings);
    if (!coords) { await reset(target, 'A regler'); return; }
    try {
      // On LIT l'ampoule plutot que de la supposer allumee : elle a pu etre
      // eteinte depuis l'application Calex, et une touche qui ment est pire
      // qu'une touche muette.
      const state = await withRetry(coords, (bulb) => bulb.read());
      await paint(target, state.color ?? configured(ev.payload.settings), state.on);
    } catch {
      await reset(target, 'Hors ligne');
    }
  }

  override async onKeyDown(ev: KeyDownEvent<ColorSettings>): Promise<void> {
    const target = ev.action as unknown as Paintable;
    const { settings } = ev.payload;
    const coords = await coordinatesFor(settings);
    if (!coords) { await reset(target, 'A regler'); return; }

    const wanted = configured(settings);
    try {
      await withRetry(coords, async (bulb) => {
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
    const coords = await coordinatesFor(settings);
    if (!coords) { await reset(target, 'A regler'); return; }

    const step = Math.abs(settings.step ?? DEFAULT_STEP);
    try {
      const applied = await withRetry(coords, async (bulb) => {
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
    const coords = await coordinatesFor(settings);
    if (!coords) return;
    try {
      const on = await withRetry(coords, (bulb) => bulb.togglePower());
      await paint(target, configured(settings), on);
    } catch {
      await target.showAlert();
    }
  }
}

async function paint(target: Paintable, color: Hsv, on: boolean = true): Promise<void> {
  // La goutte prend la couleur reellement appliquee : aucun mot ne decrit une
  // teinte aussi bien que la teinte elle-meme.
  await target.setImage?.(colorKey(hsvToHex(color), on));
  await target.setTitle('');
  if (typeof target.setFeedback === 'function') {
    await target.setFeedback({
      title: 'Couleur',
      value: on ? hueName(color.h) : 'Eteinte',
      indicator: Math.round((color.h / 360) * 100),
    });
  }
}
