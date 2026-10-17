/**
 * Bascule d'allumage commune aux actions, pour une ou plusieurs ampoules.
 *
 * Ce que fait ce module : allumer ou eteindre le groupe d'une touche, en un
 * seul geste que toggle, intensite, couleur et temperature partagent (leur
 * molette s'enfonce pour basculer).
 *
 * Choix non evident : UNE seule ampoule garde son aller-retour unique
 * (`togglePower`), parce que c'est la reactivite de ~23 ms qui justifie le
 * projet. Un groupe lit d'abord l'etat de chaque lampe, puis decide pour tout
 * le monde (voir `nextPower`) — inverser chaque lampe de son cote ferait
 * s'echanger les lampes allumees et eteintes d'une piece a moitie eclairee.
 *
 * La lecture d'un groupe est SILENCIEUSE : une lampe qui ne repond pas a la
 * lecture ne repondra pas a l'ecriture, et c'est l'ecriture qui la signale. La
 * nommer deux fois au journal ne dirait rien de plus.
 */
import type { Coordinates } from '../bulbs.js';
import { withRetry } from '../driver/pool.js';
import type { Reportable } from './failure.js';
import { fanOut, nextPower } from './group.js';
import { applyToAll, type RunReport } from './run.js';

/**
 * Bascule le groupe et rend l'etat atteint, ou `null` apres avoir reporte la panne.
 */
export async function toggleAll(
  target: Reportable,
  coords: readonly Coordinates[],
  report: RunReport,
): Promise<boolean | null> {
  if (coords.length === 1) {
    const [on] = (await applyToAll(target, coords, (bulb) => bulb.togglePower(), report)) ?? [];
    return on ?? null;
  }

  const { values } = await fanOut(coords, (c) => withRetry(c, (bulb) => bulb.read()));
  const wanted = nextPower(values.map((state) => state.on));

  const done = await applyToAll(target, coords, async (bulb) => { await bulb.setPower(wanted); }, report);
  return done ? wanted : null;
}
