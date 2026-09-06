/**
 * Action « scenario ».
 *
 * Un appui lance le scenario choisi dans le panneau ; un second l'arrete et
 * remet la lampe exactement comme elle etait. Sur une molette, l'appui fait la
 * meme chose.
 *
 * Choix non evident : la touche n'entretient AUCUN etat local. Elle demande au
 * moteur si un scenario tourne sur l'ampoule visee, et se dessine d'apres cette
 * reponse. C'est ce qui permet a deux touches pointant la meme lampe de rester
 * d'accord, et a une touche de retrouver le bon dessin apres un changement de
 * profil ou un redemarrage du plugin.
 *
 * Consequence assumee : un scenario continue de tourner quand la touche
 * disparait (changement de profil). L'arreter d'office trahirait un lever de
 * soleil de cinq minutes lance juste avant de basculer sur un autre profil ; le
 * moteur, lui, coupe tout a l'extinction du plugin.
 */
import { action, SingletonAction } from '@elgato/streamdeck';
import type { DialDownEvent, DidReceiveSettingsEvent, KeyDownEvent, WillAppearEvent, WillDisappearEvent } from '@elgato/streamdeck';

import { coordinatesFor, resolve } from '../bulbs.js';
import { reportFailure } from './failure.js';
import { cancelRecovery } from './recovery.js';
import { scenarioName, t } from '../i18n.js';
import { asImage, scenarioKey } from '../key-art.js';
import { byId } from '../scenarios/catalogue.js';
import { runningOn, start, stop, type Target } from '../scenarios/runner.js';
import type { ScenarioSettings } from '../settings.js';

type Paintable = {
  /** Identifiant d'instance de la touche, cle du cycle de reprise. */
  readonly id: string;
  setTitle(title: string): Promise<void>;
  showAlert(): Promise<void>;
  setImage?: (image?: string) => Promise<void>;
  setFeedback?: (payload: Record<string, unknown>) => Promise<void>;
};

/** Ramene la touche a son apparence de repos, avec un mot d'explication. */
async function reset(target: Paintable, label: string): Promise<void> {
  await target.setImage?.(undefined);
  await target.setTitle(label);
}

/**
 * Les ampoules que cette touche pilote, dans l'ordre des roles.
 *
 * La seconde est facultative et n'est retenue que si elle est bien distincte de
 * la premiere : la meme lampe dans les deux roles produirait un scenario qui se
 * contredit d'une image a l'autre.
 */
async function targetsFor(settings: ScenarioSettings): Promise<Target[]> {
  const primary = await coordinatesFor(settings);
  if (!primary) return [];

  if (!settings.deviceId2 || settings.deviceId2 === primary.id) return [primary];
  const second = await resolve(settings.deviceId2);
  if (!second?.key) return [primary];

  return [primary, {
    id: second.id,
    key: second.key,
    ...(second.ip ? { ip: second.ip } : {}),
    ...(second.version ? { version: second.version } : {}),
  }];
}

@action({ UUID: 'com.lumendeck.bulb.scenario' })
export class ScenarioAction extends SingletonAction<ScenarioSettings> {
  /**
   * La touche quitte l'ecran : on coupe son cycle de reprise.
   *
   * Sans cela, une page qu'on quitte laisserait une relecture programmee
   * interroger l'ampoule pour repeindre un ecran que plus personne ne regarde,
   * en consommant au passage une des rares connexions qu'elle accepte.
   */
  override onWillDisappear(ev: WillDisappearEvent<ScenarioSettings>): void {
    cancelRecovery(ev.action.id);
  }

  override async onWillAppear(ev: WillAppearEvent<ScenarioSettings>): Promise<void> {
    await this.repaint(ev.action as unknown as Paintable, ev.payload.settings);
  }

  /** Un reglage a change : la touche peut viser un autre scenario ou une autre lampe. */
  override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<ScenarioSettings>): Promise<void> {
    await this.repaint(ev.action as unknown as Paintable, ev.payload.settings);
  }

  override async onKeyDown(ev: KeyDownEvent<ScenarioSettings>): Promise<void> {
    await this.toggle(ev.action as unknown as Paintable, ev.payload.settings);
  }

  override async onDialDown(ev: DialDownEvent<ScenarioSettings>): Promise<void> {
    await this.toggle(ev.action as unknown as Paintable, ev.payload.settings);
  }

  /** Lance le scenario, ou l'arrete s'il tournait deja. */
  private async toggle(target: Paintable, settings: ScenarioSettings): Promise<void> {
    const scenario = byId(settings.scenarioId);
    const targets = await targetsFor(settings);
    const primary = targets[0];

    if (!scenario || !primary) {
      await reset(target, t('key.toSet'));
      return;
    }

    try {
      if (runningOn(primary.id)) await stop(primary.id);
      else await start(scenario, targets);
    } catch (error) {
      // On NE repeint PAS derriere : paint() remet un titre vide, et le mot
      // d'explication disparaitrait aussitot ecrit.
      await reportFailure(target, error, { where: 'scenario', deviceId: primary.id, alert: true, recover: () => this.repaint(target, settings) });
      return;
    }
    await this.paint(target, settings);
  }

  /** Redessine d'apres l'etat reel du moteur. */
  private async repaint(target: Paintable, settings: ScenarioSettings): Promise<void> {
    if (!byId(settings.scenarioId) || !(await coordinatesFor(settings))) {
      await reset(target, t('key.toSet'));
      return;
    }
    await this.paint(target, settings);
  }

  private async paint(target: Paintable, settings: ScenarioSettings): Promise<void> {
    const scenario = byId(settings.scenarioId);
    if (!scenario) return;

    const coords = await coordinatesFor(settings);
    const running = runningOn(coords?.id) === scenario.id;

    await target.setImage?.(asImage(scenarioKey(scenarioName(scenario.id), running)));
    await target.setTitle('');
    if (typeof target.setFeedback === 'function') {
      await target.setFeedback({
        title: t('dial.scenario'),
        value: scenarioName(scenario.id),
        indicator: running ? 100 : 0,
      });
    }
  }
}
