/**
 * Verifie la decision prise pour chaque rachat de points. Aucun reseau, aucune
 * ampoule : les effets sont des faux qui notent ce qu'on leur demande.
 *
 * Le principe a defendre : un viewer ne perd JAMAIS ses points pour rien. Soit
 * la couleur est appliquee et le rachat valide, soit il est rembourse — y
 * compris quand les ampoules sont injoignables ou que quelque chose plante.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createRedemptionHandler, staleRedemptions } from '../../twitch/handler.ts';

const redemption = (over = {}) => ({ id: 'r-1', rewardId: 'rw-color', rewardTitle: 'Choisis la couleur', rewardCost: 200, userName: 'Viewer', userInput: 'rouge', ...over });

/** Les recompenses connues du test : la saisie libre, une couleur fixe, la surprise, un scenario. */
const ACTIONS = {
  'rw-color': { kind: 'free' },
  'rw-bleu': { kind: 'color', color: { h: 230, s: 100, v: 100 } },
  'rw-surprise': { kind: 'surprise' },
  'rw-orage': { kind: 'scenario', scenarioId: 'orage' },
};

/** Monte un gestionnaire dont les effets sont enregistres dans `log`. */
function setup(over = {}) {
  const log = [];
  const handle = createRedemptionHandler({
    actionFor: (id) => ACTIONS[id],
    enabled: () => true,
    applyColor: async (color) => { log.push(['apply', color]); return true; },
    playScenario: async (id, cost) => { log.push(['play', id, cost]); return true; },
    random: () => 0.5,
    settle: async (r, outcome) => { log.push(['settle', r.id, outcome]); },
    report: (event) => { log.push(['report', event.outcome, event.reason]); },
    ...over,
  });
  return { handle, log };
}

test('une couleur valide est appliquee PUIS le rachat est valide', async () => {
  const { handle, log } = setup();
  await handle(redemption());
  assert.deepEqual(log, [
    ['apply', { h: 0, s: 100, v: 100 }],
    ['settle', 'r-1', 'fulfil'],
    ['report', 'applied', undefined],
  ]);
});

test('un texte invalide est rembourse sans toucher aux ampoules', async () => {
  const { handle, log } = setup();
  await handle(redemption({ userInput: 'rouge vif' }));
  assert.deepEqual(log, [['settle', 'r-1', 'refund'], ['report', 'refunded', 'unknown']]);
});

test('un noir est rembourse avec sa raison', async () => {
  const { handle, log } = setup();
  await handle(redemption({ userInput: 'noir' }));
  assert.deepEqual(log, [['settle', 'r-1', 'refund'], ['report', 'refunded', 'too-dark']]);
});

test('des ampoules injoignables : le viewer est rembourse', async () => {
  const { handle, log } = setup({ applyColor: async () => false });
  await handle(redemption());
  assert.deepEqual(log, [['settle', 'r-1', 'refund'], ['report', 'refunded', 'bulbs-unreachable']]);
});

test('un plantage pendant l application rembourse aussi, sans propager', async () => {
  const { handle, log } = setup({ applyColor: async () => { throw new Error('boum'); } });
  await handle(redemption());
  assert.deepEqual(log, [['settle', 'r-1', 'refund'], ['report', 'refunded', 'bulbs-unreachable']]);
});

test('en pause, tout est rembourse et rien n est applique', async () => {
  const { handle, log } = setup({ enabled: () => false });
  await handle(redemption());
  assert.deepEqual(log, [['settle', 'r-1', 'refund'], ['report', 'refunded', 'paused']]);
});

test('une recompense qui n est pas la notre est laissee tranquille', async () => {
  const { handle, log } = setup();
  await handle(redemption({ rewardId: 'rw-autre' }));
  assert.deepEqual(log, []);
});

test('sans recompense connue, rien n est fait', async () => {
  const { handle, log } = setup({ actionFor: () => undefined });
  await handle(redemption());
  assert.deepEqual(log, []);
});

test('un rachat rejoue par Twitch n est traite qu une fois', async () => {
  const { handle, log } = setup();
  await handle(redemption());
  await handle(redemption());
  assert.equal(log.filter((entry) => entry[0] === 'apply').length, 1);
});

test('si Twitch refuse la cloture, le plugin ne plante pas et le dit', async () => {
  const { handle, log } = setup({ settle: async () => { throw new Error('403'); } });
  await handle(redemption());
  // La couleur est appliquee, mais on ne peut pas affirmer que le rachat est clos.
  assert.deepEqual(log, [['apply', { h: 0, s: 100, v: 100 }], ['report', 'unsettled', undefined]]);
});

test('les rachats sont traites un par un, dans l ordre d arrivee', async () => {
  // Arrange : le premier est lent. Le second ne doit pas le doubler.
  const order = [];
  const { handle } = setup({
    applyColor: async (color) => {
      order.push('debut ' + color.h);
      await new Promise((resolve) => setTimeout(resolve, color.h === 0 ? 40 : 0));
      order.push('fin ' + color.h);
      return true;
    },
  });
  // Act
  await Promise.all([handle(redemption({ id: 'a', userInput: 'rouge' })), handle(redemption({ id: 'b', userInput: 'vert' }))]);
  // Assert
  assert.deepEqual(order, ['debut 0', 'fin 0', 'debut 120', 'fin 120']);
});

test('un rachat qui plante n empeche pas le suivant', async () => {
  const { handle, log } = setup({
    settle: async (r) => { if (r.id === 'a') throw new Error('x'); log.push(['settle', r.id]); },
  });
  await handle(redemption({ id: 'a' }));
  await handle(redemption({ id: 'b', userInput: 'bleu' }));
  assert.ok(log.some((entry) => entry[0] === 'settle' && entry[1] === 'b'));
});

test('un remboursement refuse par Twitch est dit tel quel : la couleur n a PAS ete posee', async () => {
  // Le panneau ne doit pas annoncer « couleur appliquee » : ici elle ne l'est pas.
  const { handle, log } = setup({ settle: async () => { throw new Error('429'); } });
  await handle(redemption({ userInput: 'rouge vif' }));
  assert.deepEqual(log, [['report', 'refund-failed', 'unknown']]);
});

test('un rapport qui plante n empeche pas le rachat suivant', async () => {
  const seen = [];
  const handle = createRedemptionHandler({
    actionFor: (id) => ACTIONS[id],
    enabled: () => true,
    applyColor: async () => true,
    playScenario: async () => true,
    settle: async () => {},
    report: (event) => { seen.push(event.redemption.id); if (event.redemption.id === 'a') throw new Error('boum'); },
  });
  await handle(redemption({ id: 'a' }));
  await handle(redemption({ id: 'b', userInput: 'bleu' }));
  assert.deepEqual(seen, ['a', 'b']);
});

test('au-dela de 200 rachats, les plus anciens sont oublies', async () => {
  const { handle, log } = setup();
  for (let i = 0; i < 201; i += 1) await handle(redemption({ id: 'r-' + i }));
  const applied = log.filter((entry) => entry[0] === 'apply').length;
  await handle(redemption({ id: 'r-0' })); // le premier a ete oublie : il est retraite
  assert.equal(log.filter((entry) => entry[0] === 'apply').length, applied + 1);
  await handle(redemption({ id: 'r-200' })); // le dernier est encore connu : il ne l'est pas
  assert.equal(log.filter((entry) => entry[0] === 'apply').length, applied + 1);
});

const pending = (id, ageMs, now) => ({ id, rewardId: 'rw-color', redeemedAt: now - ageMs });

test('seuls les rachats assez anciens sont rembourses au balayage', () => {
  // Un rachat de quelques secondes est peut-etre en cours de traitement : y toucher ferait un double emploi.
  const now = 1_000_000;
  const stale = staleRedemptions([pending('vieux', 120_000, now), pending('recent', 5_000, now)], now, 60_000);
  assert.deepEqual(stale.map((p) => p.id), ['vieux']);
});

test('le balayage ne touche jamais un rachat que le gestionnaire connait deja', async () => {
  const { handle } = setup();
  await handle(redemption({ id: 'connu' }));
  const now = 1_000_000;
  const stale = staleRedemptions([pending('connu', 120_000, now), pending('autre', 120_000, now)], now, 60_000, handle.isKnown);
  assert.deepEqual(stale.map((p) => p.id), ['autre']);
});

test('une couleur de la palette s applique sans lire le texte du viewer', async () => {
  const { handle, log } = setup();
  await handle(redemption({ rewardId: 'rw-bleu', userInput: 'rouge vif, peu importe' }));
  assert.deepEqual(log, [['apply', { h: 230, s: 100, v: 100 }], ['settle', 'r-1', 'fulfil'], ['report', 'applied', undefined]]);
});

test('la couleur surprise suit le tirage', async () => {
  const { handle, log } = setup();
  await handle(redemption({ rewardId: 'rw-surprise', userInput: '' }));
  assert.deepEqual(log[0], ['apply', { h: 180, s: 100, v: 100 }]);
});

test('un scenario se lance avec le prix paye, qui decide de sa duree', async () => {
  const { handle, log } = setup();
  await handle(redemption({ rewardId: 'rw-orage', rewardCost: 500, userInput: '' }));
  assert.deepEqual(log, [['play', 'orage', 500], ['settle', 'r-1', 'fulfil'], ['report', 'applied', undefined]]);
});

test('un scenario qui ne peut pas se lancer est rembourse', async () => {
  const { handle, log } = setup({ playScenario: async () => false });
  await handle(redemption({ rewardId: 'rw-orage', userInput: '' }));
  assert.deepEqual(log, [['settle', 'r-1', 'refund'], ['report', 'refunded', 'bulbs-unreachable']]);
});

test('en pause, un scenario n est pas lance et le viewer est rembourse', async () => {
  const { handle, log } = setup({ enabled: () => false });
  await handle(redemption({ rewardId: 'rw-orage', userInput: '' }));
  assert.deepEqual(log, [['settle', 'r-1', 'refund'], ['report', 'refunded', 'paused']]);
});
