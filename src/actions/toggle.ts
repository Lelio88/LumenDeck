/**
 * Action « allumer / eteindre ».
 *
 * Fonctionne indifferemment sur une touche (appui) et sur une molette du Stream
 * Deck+ (appui molette), le manifeste declarant les deux controleurs.
 *
 * Choix non evident : l'etat affiche est TOUJOURS relu depuis l'ampoule, jamais
 * deduit d'un compteur local. L'ampoule peut avoir ete allumee depuis l'appli
 * Calex, un assistant vocal ou une autre touche ; un etat suppose finirait
 * inevitablement desynchronise, et une touche qui ment est pire qu'une touche
 * sans etat.
 */
import { action, SingletonAction } from '@elgato/streamdeck';
import type { DialDownEvent, DidReceiveSettingsEvent, KeyDownEvent, WillAppearEvent, WillDisappearEvent } from '@elgato/streamdeck';
import { withRetry } from '../driver/pool.js';
import { coordinatesFor } from '../bulbs.js';
import { reportFailure } from './failure.js';
import { cancelRecovery } from './recovery.js';
import { t } from '../i18n.js';
import type { BulbSettings } from '../settings.js';

type Paintable = {
  /** Identifiant d'instance de la touche, cle du cycle de reprise. */
  readonly id: string;
  setTitle(title: string): Promise<void>;
  showAlert(): Promise<void>;
  /** N'existe que sur une touche : une molette n'a pas d'etats. */
  setState?: (state: number) => Promise<void>;
};

/**
 * Reporte l'etat sur la touche.
 *
 * Par l'IMAGE quand c'est possible : Stream Deck dessine le titre par dessus
 * l'image, et un mot ecrit sur un glyphe est illisible autant qu'inutile — une
 * ampoule qui s'allume visuellement dit la meme chose, mieux. Sur une molette,
 * qui n'a pas d'etats, le texte reste le seul canal.
 */
async function paint(target: Paintable, on: boolean): Promise<void> {
  if (typeof target.setState === 'function') {
    await target.setState(on ? 1 : 0);
    await target.setTitle('');
    return;
  }
  await target.setTitle(on ? t('key.on') : t('key.off'));
}

@action({ UUID: 'com.lumendeck.bulb.toggle' })
export class ToggleBulb extends SingletonAction<BulbSettings> {
  /**
   * La touche quitte l'ecran : on coupe son cycle de reprise.
   *
   * Sans cela, une page qu'on quitte laisserait une relecture programmee
   * interroger l'ampoule pour repeindre un ecran que plus personne ne regarde,
   * en consommant au passage une des rares connexions qu'elle accepte.
   */
  override onWillDisappear(ev: WillDisappearEvent<BulbSettings>): void {
    cancelRecovery(ev.action.id);
  }

  override async onWillAppear(ev: WillAppearEvent<BulbSettings>): Promise<void> {
    await this.refresh(ev.action as unknown as Paintable, ev.payload.settings);
  }

  /**
   * Un reglage a change dans le panneau.
   *
   * Ce n'est pas cosmetique : la touche peut desormais designer une AUTRE
   * ampoule. On relit donc l'etat plutot que de garder l'affichage precedent,
   * qui parlerait de la mauvaise lampe.
   */
  override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<BulbSettings>): Promise<void> {
    await this.refresh(ev.action as unknown as Paintable, ev.payload.settings);
  }

  override async onKeyDown(ev: KeyDownEvent<BulbSettings>): Promise<void> {
    await this.toggle(ev.action as unknown as Paintable, ev.payload.settings);
  }

  override async onDialDown(ev: DialDownEvent<BulbSettings>): Promise<void> {
    await this.toggle(ev.action as unknown as Paintable, ev.payload.settings);
  }

  /** Bascule l'ampoule puis reporte l'etat REEL sur la touche. */
  private async toggle(target: Paintable, settings: BulbSettings): Promise<void> {
    const coords = await coordinatesFor(settings);
    if (!coords) { await target.setTitle(t('key.toSet')); return; }
    try {
      const on = await withRetry(coords, (bulb) => bulb.togglePower());
      await paint(target, on);
    } catch (error) {
      await reportFailure(target, error, { where: 'toggle', deviceId: coords.id, alert: true, recover: () => this.refresh(target, settings) });
    }
  }

  /** Lit l'etat courant sans le modifier, pour l'affichage initial. */
  private async refresh(target: Paintable, settings: BulbSettings): Promise<void> {
    const coords = await coordinatesFor(settings);
    if (!coords) { await target.setTitle(t('key.toSet')); return; }
    try {
      const state = await withRetry(coords, (bulb) => bulb.read());
      await paint(target, state.on);
    } catch (error) {
      await reportFailure(target, error, { where: 'toggle.refresh', deviceId: coords.id, recover: () => this.refresh(target, settings) });
    }
  }
}
