/**
 * Test d'integration sur materiel reel — exige une ampoule joignable.
 *
 * Valide la promesse centrale du pilote : setBrightness agit VRAIMENT, quel que
 * soit le mode courant. C'est le defaut classique des integrations Tuya, et la
 * seule facon de le verifier est de le faire sur l'ampoule.
 *
 * Protocole : l'etat brut est releve avant, puis restaure a l'identique apres,
 * y compris les datapoints que le modele metier n'expose pas.
 *
 *   node src/driver/__tests__/live.integration.mjs
 */
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import TuyAPI from 'tuyapi';
import { TuyaLanDriver } from '../tuya.ts';
import { hexToHsv } from '../../color-format.ts';
import { discover } from '../../discovery.ts';

// Coffre par defaut : le dossier `.lumendeck-secrets/` a cote du depot, comme
// le veut la convention du projet. Chemin RELATIF, donc valable pour n'importe
// qui : ces deux outils se lancent par `npm run`, depuis la racine du depot.
// `LUMENDECK_VAULT` surcharge pour un rangement different.
const VAULT = process.env.LUMENDECK_VAULT ?? '../.lumendeck-secrets/tuya-devices.csv';

/** Trouve l'adresse d'une ampoule en ecoutant ses annonces. */
async function locate(id) {
  const found = await discover(7000);
  const match = found.find((b) => b.id === id);
  if (!match) {
    throw new Error(
      'Ampoule ' + id + ' introuvable sur le reseau. Verifiez qu elle est alimentee, '
      + 'ou definissez LUMENDECK_IP pour imposer une adresse.',
    );
  }
  return match.ip;
}

const [head, row] = readFileSync(VAULT, 'utf8').trim().split(/\r?\n/);
const cols = head.split(',');
const dev = Object.fromEntries(cols.map((c, i) => [c, row.split(',')[i]]));
const IP = process.env.LUMENDECK_IP ?? (await locate(dev.id));
const cfg = { id: dev.id, key: dev.local_key, ip: IP };

/** Ouvre une connexion brute le temps d'une operation, puis la referme. */
async function raw(fn) {
  const d = new TuyAPI({ ...cfg, version: '3.3' });
  await d.connect();
  try { return await fn(d); } finally { d.disconnect(); }
}

const show = (label, dps) =>
  console.log(`  ${label.padEnd(34)} 20=${dps['20']}  21=${dps['21']}  22=${dps['22']}  23=${dps['23']}  24=${dps['24']}`);

let failures = 0;
const check = (label, fn) => {
  try { fn(); console.log(`  OK   ${label}`); }
  catch (e) { failures++; console.log(`  ECHEC ${label}\n        ${e.message}`); }
};

console.log('ETAT INITIAL');
const before = await raw((d) => d.get({ schema: true }).then((s) => s.dps));
show('releve brut', before);

const bulb = await TuyaLanDriver.connect(cfg);
try {
  console.log('\n1. MODE COULEUR — la luminosite doit vivre dans la couleur');
  await bulb.setPower(true);
  await bulb.setColor({ h: 280, s: 100, v: 80 });
  let s = await bulb.read();
  check('passe bien en mode colour', () => assert.equal(s.mode, 'colour'));
  check('la teinte demandee est appliquee', () => assert.equal(s.color.h, 280));

  await bulb.setBrightness(30);
  s = await bulb.read();
  check('reste en mode colour apres setBrightness', () => assert.equal(s.mode, 'colour'));
  check('la luminosite a bien change (30 %)', () => assert.equal(s.brightness, 30));
  check('elle a ete ecrite DANS la couleur', () => assert.equal(s.color.v, 30));
  check('la teinte n a pas ete perdue', () => assert.equal(s.color.h, 280));

  console.log('\n2. MODE BLANC — la luminosite doit vivre dans son propre reglage');
  await bulb.setTemperature(2700);
  s = await bulb.read();
  check('passe bien en mode white', () => assert.equal(s.mode, 'white'));
  check('temperature chaude appliquee', () => assert.ok(Math.abs(s.temperatureK - 2700) <= 20, `obtenu ${s.temperatureK} K`));

  await bulb.setBrightness(80);
  s = await bulb.read();
  check('reste en mode white', () => assert.equal(s.mode, 'white'));
  check('la luminosite a bien change (80 %)', () => assert.equal(s.brightness, 80));

  console.log('\n3. BORNES — la molette ne doit jamais sortir de la plage');
  check('vers le haut, borne a 100', async () => {});
  const high = await bulb.nudgeBrightness(+50);
  check(`+50 depuis 80 borne a 100 (obtenu ${high})`, () => assert.equal(high, 100));
  const low = await bulb.nudgeBrightness(-200);
  check(`-200 borne a 1 (obtenu ${low})`, () => assert.equal(low, 1));

  console.log('');
  console.log('4. CHAINE COMPLETE depuis le format de l interface');
  const wanted = hexToHsv('#ff8800');
  await bulb.setColor(wanted);
  s = await bulb.read();
  check('la couleur hexadecimale arrive intacte sur l ampoule', () => {
    assert.equal(s.mode, 'colour', 'devrait etre en mode couleur');
    assert.ok(Math.abs(s.color.h - wanted.h) <= 2, 'teinte ' + s.color.h + ', attendue ' + wanted.h);
    assert.ok(Math.abs(s.color.s - wanted.s) <= 2, 'saturation ' + s.color.s + ', attendue ' + wanted.s);
  });

  await bulb.setTemperature(2700);
  s = await bulb.read();
  check('la temperature chaude bascule bien en blanc', () => {
    assert.equal(s.mode, 'white');
    assert.ok(Math.abs(s.temperatureK - 2700) <= 20, 'obtenu ' + s.temperatureK + ' K');
  });
} finally {
  await bulb.close();
}

console.log('\nRESTAURATION de l etat initial');
// Deux temps, et l'ordre compte : ecrire la temperature (DP 23) bascule
// l'ampoule en mode blanc de son propre chef. Le mode doit donc etre ecrit
// EN DERNIER, sinon il est ecrase par les valeurs qu'on vient de poser.
await raw(async (d) => {
  await d.set({ multiple: true, data: { '22': before['22'], '23': before['23'], '24': before['24'] } });
  await d.set({ multiple: true, data: { '21': before['21'], '20': before['20'] } });
});
const after = await raw((d) => d.get({ schema: true }).then((s) => s.dps));
show('releve final', after);

const drift = ['20', '21', '22', '23', '24'].filter((k) => String(before[k]) !== String(after[k]));
console.log(drift.length === 0
  ? '\nEtat restaure a l identique.'
  : `\nATTENTION derive sur : ${drift.join(', ')}`);
console.log(failures === 0 ? 'TOUTES LES VERIFICATIONS PASSENT.' : `${failures} VERIFICATION(S) EN ECHEC.`);
process.exit(failures === 0 && drift.length === 0 ? 0 : 1);
