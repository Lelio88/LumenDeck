/**
 * Verifie le catalogue des recompenses Twitch. Aucun SDK, aucun reseau.
 *
 * Ce qui casse en silence : un reglage de panneau aberrant qui creerait des
 * recompenses fantomes, une duree de scenario non bornee payee par un viewer,
 * deux recompenses au meme titre (Twitch refuse la seconde), ou une recompense
 * a saisie libre qui perdrait sa zone de texte.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  DEFAULT_CONFIG, PALETTE, actionFor, normalizeConfig, planRewards, scenarioDuration, surpriseColor, wantedRewards,
} from '../../twitch/rewards.ts';

const SCENARIO_IDS = ['clignotement', 'gyrophare', 'respiration', 'bougie', 'orage', 'arc-en-ciel', 'alerte', 'lever-de-soleil'];
/** Une « traduction » qui rend la cle : suffit a verifier les titres sans dictionnaire. */
const t = (key) => key;

test('la palette propose neuf couleurs, chacune avec une teinte valide et un identifiant unique', () => {
  assert.equal(PALETTE.length, 9);
  assert.equal(new Set(PALETTE.map((c) => c.id)).size, 9);
  for (const color of PALETTE) assert.ok(color.color.v >= 20, color.id);
});

test('un panneau vide donne la configuration par defaut', () => {
  assert.deepEqual(normalizeConfig({}, SCENARIO_IDS), DEFAULT_CONFIG);
  assert.deepEqual(normalizeConfig(undefined, SCENARIO_IDS), DEFAULT_CONFIG);
});

test('les valeurs inconnues ou mal typees sont ecartees, jamais propagees', () => {
  const config = normalizeConfig({
    colors: ['rouge', 'inconnue', 7, 'rouge'],
    scenarios: ['orage', 'pas-un-scenario'],
    surprise: 'oui',
    freeText: false,
    secondsPer100: 'beaucoup',
    maxSeconds: -4,
    together: true,
  }, SCENARIO_IDS);
  assert.deepEqual(config.colors, ['rouge']);
  assert.deepEqual(config.scenarios, ['orage']);
  assert.equal(config.surprise, DEFAULT_CONFIG.surprise);
  assert.equal(config.freeText, false);
  assert.equal(config.secondsPer100, DEFAULT_CONFIG.secondsPer100);
  assert.ok(config.maxSeconds >= 5);
  assert.equal(config.together, true);
});

test('les durees sont bornees : un panneau ne peut pas demander une heure', () => {
  const config = normalizeConfig({ secondsPer100: 10_000, maxSeconds: 10_000 }, SCENARIO_IDS);
  assert.ok(config.secondsPer100 <= 60);
  assert.ok(config.maxSeconds <= 300);
});

test('la duree d un scenario suit le prix paye, dans les bornes', () => {
  assert.equal(scenarioDuration(300, 10, 60), 30_000);
  assert.equal(scenarioDuration(1000, 10, 60), 60_000, 'plafonnee');
  assert.equal(scenarioDuration(10, 10, 60), 5_000, 'jamais moins de 5 s : un effet invisible ne vaut rien');
  assert.equal(scenarioDuration(Number.NaN, 10, 60), 5_000);
});

test('chaque choix du panneau devient UNE recompense, avec une cle stable et un titre unique', () => {
  const config = normalizeConfig({ colors: ['rouge', 'bleu'], surprise: true, freeText: true, scenarios: ['orage'] }, SCENARIO_IDS);
  const rewards = wantedRewards(config, t);
  assert.deepEqual(rewards.map((r) => r.key).sort(), ['color:bleu', 'color:rouge', 'free', 'scenario:orage', 'surprise']);
  assert.equal(new Set(rewards.map((r) => r.title)).size, rewards.length);
});

test('seule la saisie libre demande au viewer d ecrire', () => {
  const rewards = wantedRewards(DEFAULT_CONFIG, t);
  for (const reward of rewards) assert.equal(reward.userInput, reward.key === 'free', reward.key);
});

test('decocher tout ne laisse aucune recompense', () => {
  const config = normalizeConfig({ colors: [], surprise: false, freeText: false, scenarios: [] }, SCENARIO_IDS);
  assert.deepEqual(wantedRewards(config, t), []);
});

test('une cle de recompense se traduit en action, et une cle inconnue en rien', () => {
  assert.deepEqual(actionFor('free'), { kind: 'free' });
  assert.deepEqual(actionFor('surprise'), { kind: 'surprise' });
  assert.deepEqual(actionFor('scenario:orage'), { kind: 'scenario', scenarioId: 'orage' });
  assert.deepEqual(actionFor('color:rouge'), { kind: 'color', color: PALETTE.find((c) => c.id === 'rouge').color });
  assert.equal(actionFor('color:inconnue'), undefined);
  assert.equal(actionFor('n importe quoi'), undefined);
});

test('la couleur surprise est toujours vive et suit le tirage', () => {
  assert.deepEqual(surpriseColor(() => 0), { h: 0, s: 100, v: 100 });
  assert.equal(surpriseColor(() => 0.5).h, 180);
  assert.ok(surpriseColor(() => 0.9999).h < 360);
});

// --- Plan de synchronisation -------------------------------------------------

const spec = (key, title) => ({ key, title, prompt: '', cost: 100, cooldownSeconds: 30, userInput: false });
const reward = (id, title) => ({ id, title, cost: 100, prompt: '', isEnabled: true });

test('une recompense deja connue est gardee, une manquante est a creer', () => {
  const plan = planRewards([spec('color:rouge', 'Lumiere rouge'), spec('color:bleu', 'Lumiere bleue')], [reward('r1', 'Lumiere rouge')], { 'color:rouge': 'r1' });
  assert.deepEqual(plan.keep, { 'color:rouge': 'r1' });
  assert.deepEqual(plan.create.map((s) => s.key), ['color:bleu']);
  assert.deepEqual(plan.remove, []);
});

test('une recompense du plugin retrouvee par son titre est reprise, pas recreee', () => {
  // Reinstallation : l'identifiant n'est plus connu, mais la recompense existe et est au plugin.
  const plan = planRewards([spec('surprise', 'Couleur surprise')], [reward('r9', 'Couleur surprise')], {});
  assert.deepEqual(plan.keep, { surprise: 'r9' });
  assert.deepEqual(plan.create, []);
});

test('une recompense du plugin qui n est plus voulue est a supprimer, avec sa cle', () => {
  const plan = planRewards([], [reward('r1', 'Ambiance : Orage')], { 'scenario:orage': 'r1' });
  assert.deepEqual(plan.remove, [{ key: 'scenario:orage', id: 'r1' }]);
});

test('une recompense gerable mais inconnue du plugin n est jamais supprimee', () => {
  // Elle vient peut-etre d'une autre installation : on ne touche qu'a ce qu'on connait.
  const plan = planRewards([], [reward('rx', 'Autre chose')], {});
  assert.deepEqual(plan.remove, []);
});

test('une recompense deja supprimee chez Twitch disparait du plan sans rien a faire', () => {
  const plan = planRewards([spec('free', 'Choisis la couleur')], [], { free: 'r-mort', 'color:rouge': 'r-mort-2' });
  assert.deepEqual(plan.keep, {});
  assert.deepEqual(plan.create.map((s) => s.key), ['free']);
  assert.deepEqual(plan.remove, []);
});

test('une meme recompense ne sert jamais deux cles', () => {
  const plan = planRewards([spec('a', 'Meme titre'), spec('b', 'Meme titre')], [reward('r1', 'Meme titre')], {});
  assert.deepEqual(Object.values(plan.keep), ['r1']);
  assert.equal(plan.create.length, 1);
});
