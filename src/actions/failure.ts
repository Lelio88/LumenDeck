/**
 * Report d'une panne de lampe : sur la touche, et dans le journal.
 *
 * Ce que fait ce module : donner aux cinq actions UN seul geste de report, pour
 * qu'une panne se raconte partout de la meme facon.
 *
 * LE CHOIX NON EVIDENT, ET LA RAISON D'ETRE DU FICHIER : chaque action faisait
 * `catch { showAlert() }`. La touche clignotait, le journal restait vide, et
 * trois pannes aux remedes opposes — cle regeneree par l'appli Calex, ampoule
 * debranchee, adresse perimee — devenaient indiscernables. Le niveau de
 * journalisation etait meme regle dans plugin.ts pour des journaux que personne
 * n'ecrivait jamais.
 *
 * CE QUI SE VOIT OU : la touche recoit UN mot, parce qu'elle fait 72 px et que
 * l'utilisateur la lit d'un coup d'oeil ; le journal recoit la cause complete,
 * parce qu'on ne l'ouvre que lorsque le mot n'a pas suffi.
 *
 * SECRET : on journalise la cause et un identifiant ABREGE, jamais les reglages
 * de la touche — la `local_key` y figure. C'est aussi pourquoi le mode trace du
 * SDK reste interdit (garde-fou n°3). Les messages de tuyapi sont sur a ce
 * titre : ils citent des HMAC derives et des fragments de trame chiffree, pas
 * le secret lui-meme.
 *
 * Usage canonique :
 *   catch (error) {
 *     await reportFailure(target, error, { where: 'toggle', deviceId, alert: true });
 *   }
 */
import streamDeck from '@elgato/streamdeck';
import { asLightError, type LightError, type LightFailure } from '../driver/errors.js';
import { t } from '../i18n.js';

/** Surface minimale d'une touche ou d'une molette, vue du report. */
export type Reportable = {
  setTitle(title: string): Promise<void>;
  showAlert(): Promise<void>;
  /** N'existe que sur une touche. `undefined` restaure l'image du manifeste. */
  setImage?: (image?: string) => Promise<void>;
};

/** Circonstances de la panne, pour le journal et pour le choix du report. */
export type Report = {
  /** Action et moment, en un mot : 'toggle', 'brightness.nudge'. Sert de portee au journal. */
  readonly where: string;
  /** Ampoule visee. Abrege avant journalisation. */
  readonly deviceId?: string | undefined;
  /** Fait clignoter la touche. RESERVE aux echecs qui suivent un geste de l'utilisateur. */
  readonly alert?: boolean;
};

/**
 * Le mot ecrit sur la touche.
 *
 * Trois mots pour quatre causes : seule « cle refusee » merite d'etre distinguee,
 * parce que c'est la seule panne que l'utilisateur repare lui-meme, et depuis le
 * panneau de configuration. Les autres appellent le meme geste — attendre, ou
 * verifier l'ampoule — et multiplier les libelles ferait deviner une nuance qui
 * ne change rien a ce qu'il y a a faire.
 */
function titleFor(failure: LightFailure): string {
  switch (failure) {
    case 'badKey':
      return t('key.badKey');
    case 'unreachable':
      return t('key.offline');
    default:
      // 'unresponsive' et 'unknown' : l'ampoule tient le reseau mais pas la
      // commande. Un mot neutre, plutot qu'un diagnostic qui enverrait
      // l'utilisateur demonter son pare-feu pour rien.
      return t('key.error');
  }
}

/**
 * Ecrit la panne au journal, une fois et une seule.
 *
 * ERROR est reserve a ce qu'on ne sait pas nommer : c'est la seule categorie qui
 * reclame vraiment une lecture humaine. Passer en ERROR les pannes attendues
 * d'un objet connecte — une ampoule qu'on debranche le soir — noierait l'anomalie
 * reelle sous le bruit domestique.
 */
function journalise(error: LightError, report: Report): void {
  const scope = streamDeck.logger.createScope(report.where);
  const bulb = report.deviceId ? '...' + report.deviceId.slice(-6) : 'ampoule unique';
  const cause = error.cause instanceof Error ? error.cause.message : String(error.cause);
  const line = 'echec ' + error.failure + ' sur ' + bulb + ' : ' + cause;

  if (error.failure === 'unknown') scope.error(line, error.cause);
  else scope.warn(line);
}

/**
 * Qualifie la panne, la journalise, et l'ecrit sur la touche.
 *
 * Efface le dessin au passage : une jauge figee sur la derniere valeur connue
 * laisserait croire que la commande a pris, et Stream Deck ecrit le titre PAR
 * DESSUS l'image — le mot d'explication y deviendrait illisible.
 */
export async function reportFailure(target: Reportable, error: unknown, report: Report): Promise<void> {
  const failure = asLightError(error);
  journalise(failure, report);

  await target.setImage?.(undefined);
  await target.setTitle(titleFor(failure.failure));
  if (report.alert) await target.showAlert();
}
