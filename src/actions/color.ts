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
import type { DialDownEvent, DialRotateEvent, DidReceiveSettingsEvent, KeyDownEvent, WillAppearEvent, WillDisappearEvent } from '@elgato/streamdeck';

import { hexToHsv, hsvToHex, rotateHue } from '../color-format.js';
import { t } from '../i18n.js';
import { asImage, colorKey } from '../key-art.js';
import { withRetry } from '../driver/pool.js';
import type { Hsv } from '../driver/types.js';
import { coordinatesFor } from '../bulbs.js';
import { reportFailure } from './failure.js';
import { cancelRecovery } from './recovery.js';
import type { ColorSettings } from '../settings.js';

/**
 * Couleur affichee par defaut, en un SEUL endroit.
 *
 * Doit rester identique au `default` du selecteur dans `ui/color.html`.
 * Raison non evidente : sdpi-components se contente d'AFFICHER cet attribut,
 * il ne l'ecrit dans les reglages qu'au premier changement. Une touche fraiche
 * a donc `color` vide et tombe forcement sur ce repli — si les deux valeurs
 * divergent, la touche peint une couleur que le panneau ne dit nulle part.
 */
const FALLBACK_HEX = '#ff8800';
const FALLBACK: Hsv = hexToHsv(FALLBACK_HEX) ?? { h: 32, s: 100, v: 100 };
/** Degres de teinte par cran de molette. */
const DEFAULT_STEP = 15;

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

/** Couleur retenue par la touche, ou le repli si elle est absente ou illisible. */
function configured(settings: ColorSettings): Hsv {
  return (settings.color ? hexToHsv(settings.color) : null) ?? FALLBACK;
}

/** Nomme grossierement une teinte, pour que la touche dise autre chose qu'un nombre. */
function hueName(h: number): string {
  const names = [
    [15, 'hue.red'], [45, 'hue.orange'], [70, 'hue.yellow'], [160, 'hue.green'],
    [200, 'hue.cyan'], [255, 'hue.blue'], [290, 'hue.violet'], [340, 'hue.pink'], [361, 'hue.red'],
  ] as const;
  for (const [limit, key] of names) if (h < limit) return t(key);
  return t('hue.red');
}

@action({ UUID: 'com.lumendeck.bulb.color' })
export class Color extends SingletonAction<ColorSettings> {
  /**
   * La touche quitte l'ecran : on coupe son cycle de reprise.
   *
   * Sans cela, une page qu'on quitte laisserait une relecture programmee
   * interroger l'ampoule pour repeindre un ecran que plus personne ne regarde,
   * en consommant au passage une des rares connexions qu'elle accepte.
   */
  override onWillDisappear(ev: WillDisappearEvent<ColorSettings>): void {
    cancelRecovery(ev.action.id);
  }

  override async onWillAppear(ev: WillAppearEvent<ColorSettings>): Promise<void> {
    await this.refresh(ev.action as unknown as Paintable, ev.payload.settings);
  }

  /** Lit l'ampoule et reporte son etat REEL. Sert aussi de point de reprise. */
  private async refresh(target: Paintable, settings: ColorSettings): Promise<void> {
    const coords = await coordinatesFor(settings);
    if (!coords) { await reset(target, t('key.toSet')); return; }
    try {
      // On LIT l'ampoule plutot que de la supposer allumee : elle a pu etre
      // eteinte depuis l'application Calex, et une touche qui ment est pire
      // qu'une touche muette.
      // On releve l'etat ET ce que la lampe sait faire dans le meme aller-retour.
      const snapshot = await withRetry(coords, async (bulb) => ({
        state: await bulb.read(),
        supported: bulb.capabilities.supportsColor,
      }));
      // Une ampoule blanche seule n'expose pas le datapoint de couleur. Le dire
      // vaut mieux que d'echouer en silence : sans ce mot, l'utilisateur conclut
      // que le plugin est casse alors que c'est son materiel qui ne sait pas.
      if (!snapshot.supported) { await reset(target, t('key.noColour')); return; }
      await paint(target, snapshot.state.color ?? configured(settings), snapshot.state.on);
    } catch (error) {
      await reportFailure(target, error, { where: 'color.refresh', deviceId: coords.id, recover: () => this.refresh(target, settings) });
    }
  }

  /**
   * Un reglage a change dans le panneau : la touche prend AUSSITOT la couleur.
   *
   * On ne consulte pas l'ampoule ici, volontairement. L'utilisateur est en train
   * de choisir une teinte : il veut la voir sur la touche pendant qu'il la
   * choisit, pas apres avoir appuye. L'apercu est fidele, puisque appuyer allume
   * l'ampoule et applique exactement cette couleur.
   */
  override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<ColorSettings>): Promise<void> {
    const target = ev.action as unknown as Paintable;
    const { settings } = ev.payload;
    if (!(await coordinatesFor(settings))) { await reset(target, t('key.toSet')); return; }
    await paint(target, configured(settings), true);
  }

  override async onKeyDown(ev: KeyDownEvent<ColorSettings>): Promise<void> {
    const target = ev.action as unknown as Paintable;
    const { settings } = ev.payload;
    const coords = await coordinatesFor(settings);
    if (!coords) { await reset(target, t('key.toSet')); return; }

    const wanted = configured(settings);
    try {
      const supported = await withRetry(coords, async (bulb) => {
        if (!bulb.capabilities.supportsColor) return false;
        // Allumer d'abord : appliquer une couleur a une ampoule eteinte est
        // silencieux, et l'utilisateur croirait la touche cassee.
        await bulb.setPower(true);
        await bulb.setColor(wanted);
        return true;
      });
      if (!supported) { await reset(target, t('key.noColour')); return; }
      await paint(target, wanted);
    } catch (error) {
      await reportFailure(target, error, { where: 'color.apply', deviceId: coords.id, alert: true, recover: () => this.refresh(target, settings) });
    }
  }

  override async onDialRotate(ev: DialRotateEvent<ColorSettings>): Promise<void> {
    const target = ev.action as unknown as Paintable;
    const { settings } = ev.payload;
    const coords = await coordinatesFor(settings);
    if (!coords) { await reset(target, t('key.toSet')); return; }

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
    } catch (error) {
      await reportFailure(target, error, { where: 'color.rotate', deviceId: coords.id, alert: true, recover: () => this.refresh(target, settings) });
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
    } catch (error) {
      await reportFailure(target, error, { where: 'color.toggle', deviceId: coords.id, alert: true, recover: () => this.refresh(target, settings) });
    }
  }
}

async function paint(target: Paintable, color: Hsv, on: boolean = true): Promise<void> {
  // La goutte prend la couleur reellement appliquee : aucun mot ne decrit une
  // teinte aussi bien que la teinte elle-meme.
  await target.setImage?.(asImage(colorKey(hsvToHex(color), on)));
  await target.setTitle('');
  if (typeof target.setFeedback === 'function') {
    await target.setFeedback({
      title: t('dial.colour'),
      value: on ? hueName(color.h) : t('key.off'),
      indicator: Math.round((color.h / 360) * 100),
    });
  }
}
