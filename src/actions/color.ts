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
import type { Hsv } from '../driver/types.js';
import { adoptBulbs, coordinatesForMany } from '../bulbs.js';
import { cancelRecovery } from './recovery.js';
import { faceValue } from './face.js';
import { toggleAll } from './power.js';
import { applyToAll } from './run.js';
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
    await adoptBulbs(ev.action, ev.payload.settings);
    await this.refresh(ev.action as unknown as Paintable, ev.payload.settings);
  }

  /** Lit les ampoules et reporte leur etat REEL. Sert aussi de point de reprise. */
  private async refresh(target: Paintable, settings: ColorSettings): Promise<void> {
    const coords = await coordinatesForMany(settings);
    if (coords.length === 0) { await reset(target, t('key.toSet')); return; }

    // On LIT les ampoules plutot que de les supposer allumees : elles ont pu etre
    // eteintes depuis l'application Calex, et une touche qui ment est pire
    // qu'une touche muette. On releve l'etat ET ce que chaque lampe sait faire
    // dans le meme aller-retour.
    const snapshots = await applyToAll(target, coords, async (bulb) => ({
      state: await bulb.read(),
      supported: bulb.capabilities.supportsColor,
    }), {
      where: 'color.refresh',
      tolerant: true,
      recover: () => this.refresh(target, settings),
    });
    if (!snapshots) return;

    // Une ampoule blanche seule n'expose pas le datapoint de couleur. Le dire
    // vaut mieux que d'echouer en silence : sans ce mot, l'utilisateur conclut
    // que le plugin est casse alors que c'est son materiel qui ne sait pas. Dans
    // un groupe mixte, la touche se dessine d'apres les lampes qui savent.
    const capable = snapshots.filter((snapshot) => snapshot.supported);
    const [first] = capable;
    if (!first) { await reset(target, t('key.noColour')); return; }
    await paint(target, faceValue(target, first.state.color, configured(settings)), capable.some((c) => c.state.on));
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
    if ((await coordinatesForMany(settings)).length === 0) { await reset(target, t('key.toSet')); return; }
    await paint(target, configured(settings), true);
  }

  override async onKeyDown(ev: KeyDownEvent<ColorSettings>): Promise<void> {
    const target = ev.action as unknown as Paintable;
    const { settings } = ev.payload;
    const coords = await coordinatesForMany(settings);
    if (coords.length === 0) { await reset(target, t('key.toSet')); return; }

    const wanted = configured(settings);
    const applied = await applyToAll(target, coords, async (bulb) => {
      if (!bulb.capabilities.supportsColor) return false;
      // Allumer d'abord : appliquer une couleur a une ampoule eteinte est
      // silencieux, et l'utilisateur croirait la touche cassee.
      await bulb.setPower(true);
      await bulb.setColor(wanted);
      return true;
    }, { where: 'color.apply', alert: true, recover: () => this.refresh(target, settings) });
    if (!applied) return;

    // Les lampes sans couleur sont simplement laissees telles quelles : le mot
    // n'apparait que si AUCUNE ne sait appliquer la teinte.
    if (!applied.some(Boolean)) { await reset(target, t('key.noColour')); return; }
    await paint(target, wanted);
  }

  /**
   * Chaque ampoule fait tourner SA teinte du meme angle.
   *
   * Les lampes d'un groupe n'ont pas forcement la meme couleur : les aligner sur
   * celle de la premiere effacerait ce que l'utilisateur a compose. Une lampe en
   * blanc, qui n'a pas de couleur courante, part de la couleur configuree.
   */
  override async onDialRotate(ev: DialRotateEvent<ColorSettings>): Promise<void> {
    const target = ev.action as unknown as Paintable;
    const { settings } = ev.payload;
    const coords = await coordinatesForMany(settings);
    if (coords.length === 0) { await reset(target, t('key.toSet')); return; }

    const step = Math.abs(settings.step ?? DEFAULT_STEP);
    const applied = await applyToAll(target, coords, async (bulb) => {
      const state = await bulb.read();
      const base = state.color ?? configured(settings);
      const next = rotateHue(base, ev.payload.ticks * step);
      await bulb.setColor(next);
      return next;
    }, { where: 'color.rotate', alert: true, recover: () => this.refresh(target, settings) });
    const [first] = applied ?? [];
    if (first) await paint(target, first);
  }

  override async onDialDown(ev: DialDownEvent<ColorSettings>): Promise<void> {
    const target = ev.action as unknown as Paintable;
    const { settings } = ev.payload;
    const coords = await coordinatesForMany(settings);
    if (coords.length === 0) return;

    const on = await toggleAll(target, coords, { where: 'color.toggle', alert: true, recover: () => this.refresh(target, settings) });
    if (on !== null) await paint(target, configured(settings), on);
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
