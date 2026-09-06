/**
 * Verifie le cycle de reprise d'une touche en panne. Aucune ampoule, aucun timer reel.
 *
 * Ce qui se teste ici n'est pas « ca reessaie » — c'est qu'un cycle s'ARRETE.
 * Un ordonnanceur qui ne sait pas se taire interrogerait une ampoule morte
 * indefiniment, et une ampoule Tuya n'accepte qu'une poignee de connexions.
 */
import assert from 'node:assert/strict';
import { mock, test, beforeEach, afterEach } from 'node:test';

import { cancelRecovery, pendingRecoveries, scheduleRecovery, DELAIS_MS } from '../../actions/recovery.ts';

/** Laisse les promesses en attente se resoudre, les minuteries etant simulees. */
const vider = () => new Promise((resolve) => setImmediate(resolve));

beforeEach(() => mock.timers.enable({ apis: ['setTimeout'] }));
afterEach(() => { mock.timers.reset(); cancelRecovery('touche-1'); });

test('une relecture ne part pas avant son delai', async () => {
  // Arrange
  let appels = 0;
  scheduleRecovery('touche-1', async () => { appels++; });
  // Act : juste avant l'echeance
  mock.timers.tick(DELAIS_MS[0] - 1);
  await vider();
  // Assert
  assert.equal(appels, 0);
});

test('une relecture qui reussit met fin au cycle', async () => {
  // Arrange : la relecture ne signale aucun echec, donc elle a repare.
  let appels = 0;
  scheduleRecovery('touche-1', async () => { appels++; });
  // Act
  mock.timers.tick(DELAIS_MS[0]);
  await vider();
  // Assert
  assert.equal(appels, 1);
  assert.equal(pendingRecoveries(), 0, 'le cycle doit s etre eteint tout seul');
});

test('une relecture qui echoue replanifie, et attend plus longtemps', async () => {
  // Arrange : la relecture resignale un echec, comme le ferait reportFailure.
  let appels = 0;
  const recover = async () => { appels++; scheduleRecovery('touche-1', recover); };
  scheduleRecovery('touche-1', recover);

  // Act : premiere echeance
  mock.timers.tick(DELAIS_MS[0]);
  await vider();
  assert.equal(appels, 1);
  assert.equal(pendingRecoveries(), 1, 'le cycle doit se poursuivre');

  // Assert : le deuxieme delai est plus long — l'ancien ne suffit plus.
  mock.timers.tick(DELAIS_MS[0]);
  await vider();
  assert.equal(appels, 1, 'la relecture suivante ne doit pas partir au premier delai');

  mock.timers.tick(DELAIS_MS[1] - DELAIS_MS[0]);
  await vider();
  assert.equal(appels, 2);
});

test('le delai plafonne au lieu de croitre sans fin', async () => {
  // Arrange
  let appels = 0;
  const recover = async () => { appels++; scheduleRecovery('touche-1', recover); };
  scheduleRecovery('touche-1', recover);
  // Act : on epuise le bareme, puis on continue au-dela.
  for (const delai of DELAIS_MS) { mock.timers.tick(delai); await vider(); }
  const apresBareme = appels;
  // Assert : le dernier delai se rejoue, il ne double pas indefiniment.
  mock.timers.tick(DELAIS_MS[DELAIS_MS.length - 1]);
  await vider();
  assert.equal(appels, apresBareme + 1);
});

test('annuler arrete tout — la touche a disparu de l ecran', async () => {
  // Arrange
  let appels = 0;
  scheduleRecovery('touche-1', async () => { appels++; });
  // Act
  cancelRecovery('touche-1');
  mock.timers.tick(DELAIS_MS[DELAIS_MS.length - 1]);
  await vider();
  // Assert
  assert.equal(appels, 0);
  assert.equal(pendingRecoveries(), 0);
});
