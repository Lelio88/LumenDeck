/**
 * Applique une operation a TOUTES les ampoules d'une touche, et rend compte.
 *
 * Ce que fait ce module : donner aux cinq actions un seul geste pour « fais
 * ceci sur mes lampes », avec le report de panne qui va avec.
 *
 * Choix non evidents :
 *
 *   - Les lampes obeissent EN PARALLELE et independamment. Une lampe debranchee
 *     dans un groupe n'empeche pas les autres : ce serait punir toute la piece
 *     pour une prise.
 *
 *   - Deux regimes de panne partielle. Un APPUI est strict : si une lampe a
 *     failli, la touche le dit (alerte + mot), parce que l'utilisateur vient de
 *     demander quelque chose et doit savoir que la piece n'est pas entiere. Une
 *     RELECTURE est tolerante : elle se dessine d'apres les lampes qui repondent
 *     et ne se declare en panne que si plus aucune ne repond — sinon une lampe
 *     debranchee a demeure laisserait « Hors ligne » sur une touche qui marche.
 *
 *   - Le journal nomme CHAQUE lampe en defaut ; la touche n'en raconte qu'une.
 *
 * Invariant : les valeurs rendues suivent l'ordre des ampoules, la premiere
 * REUSSIE en tete. La touche se dessine d'apres `values[0]`.
 *
 * Usage canonique :
 *   const levels = await applyToAll(target, coords, (b) => b.nudgeBrightness(10),
 *     { where: 'brightness.nudge', alert: true, recover: () => this.refresh(target, settings) });
 *   if (!levels) return;
 */
import type { Coordinates } from '../bulbs.js';
import { withRetry } from '../driver/pool.js';
import type { LightDriver } from '../driver/types.js';
import { logFailure, reportFailure, type Reportable } from './failure.js';
import { fanOut } from './group.js';
import type { Recover } from './recovery.js';

/** Temps laisse aux autres lampes une fois la premiere repondue, pour une relecture. */
const REFRESH_GRACE_MS = 1000;

/** Circonstances du report, ce qu'attend `reportFailure` moins l'ampoule visee. */
export type RunReport = {
  /** Action et moment, en un mot : 'toggle', 'brightness.nudge'. */
  readonly where: string;
  /** Fait clignoter la touche. RESERVE aux echecs qui suivent un geste de l'utilisateur. */
  readonly alert?: boolean;
  /** Relecture de reprise, voir `Report.recover`. */
  readonly recover: Recover;
  /** Vrai pour une relecture : une panne partielle ne declare pas la touche en defaut. */
  readonly tolerant?: boolean;
};

/**
 * Applique `op` a chaque ampoule.
 *
 * Rend les valeurs, ou `null` APRES avoir reporte la panne sur la touche : le
 * code appelant n'a alors plus rien a dessiner.
 */
export async function applyToAll<R>(
  target: Reportable,
  coords: readonly Coordinates[],
  op: (bulb: LightDriver) => Promise<R>,
  report: RunReport,
): Promise<R[] | null> {
  // Une relecture ne fait pas attendre la touche apres une lampe muette (~5 s de
  // delai de connexion) des qu'une autre a repondu ; un appui, lui, rend compte
  // de CHAQUE lampe.
  const { values, errors } = await fanOut(
    coords,
    (c) => withRetry(c, op),
    report.tolerant ? { graceMs: REFRESH_GRACE_MS } : {},
  );
  if (errors.length === 0) return values;

  const failures = errors.map(({ item, error }) => ({ deviceId: item.id, error }));
  // Tolerant : seules les lampes injoignables sont journalisees, la touche vit.
  if (report.tolerant && values.length > 0) {
    for (const f of failures) logFailure(f.error, { where: report.where, deviceId: f.deviceId });
    return values;
  }

  const [first, ...others] = failures;
  for (const f of others) logFailure(f.error, { where: report.where, deviceId: f.deviceId });
  if (first) {
    await reportFailure(target, first.error, {
      where: report.where,
      deviceId: first.deviceId,
      ...(report.alert ? { alert: true } : {}),
      recover: report.recover,
    });
  }
  return null;
}
