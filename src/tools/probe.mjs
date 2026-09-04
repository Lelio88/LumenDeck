/**
 * Sonde de diagnostic : lit l'etat d'une ampoule en LAN via tuyapi.
 *
 * Sert a deux choses : verifier qu'une local_key est valide, et relever la
 * cartographie des datapoints d'un nouveau modele avant d'ecrire son profil de
 * pilote. Lit l'inventaire depuis le coffre hors depot.
 *
 * Rien de personnel n'est code en dur : l'adresse de l'ampoule est DECOUVERTE
 * sur le reseau, et le chemin du coffre se surcharge par l'environnement. Une
 * adresse en dur ne servirait qu'a une seule machine et fuiterait dans le depot.
 *
 * Usage :
 *   node src/tools/probe.mjs                 # decouvre l'adresse
 *   node src/tools/probe.mjs 192.168.1.42    # impose une adresse
 *   LUMENDECK_VAULT=... node src/tools/probe.mjs
 */
import { readFileSync } from 'node:fs';

import TuyAPI from 'tuyapi';

import { discover } from '../discovery.ts';

const VAULT = process.env.LUMENDECK_VAULT
  ?? 'C:/Users/buton/Documents/Projets/.lumendeck-secrets/tuya-devices.csv';

/** Analyse CSV minimale, suffisante pour l'inventaire (gere les champs quotes). */
function parseCsv(text) {
  const rows = text.trim().split(/\r?\n/).map((line) => {
    const out = [];
    let cur = '', quoted = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (quoted) {
        if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (c === '"') quoted = false;
        else cur += c;
      } else if (c === '"') quoted = true;
      else if (c === ',') { out.push(cur); cur = ''; }
      else cur += c;
    }
    out.push(cur);
    return out;
  });
  const [head, ...body] = rows;
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}

const [device] = parseCsv(readFileSync(VAULT, 'utf8'));
if (!device) {
  console.error('Coffre vide ou illisible : ' + VAULT);
  process.exit(1);
}

const ip = process.argv[2]
  ?? process.env.LUMENDECK_IP
  ?? (await discover(7000)).find((b) => b.id === device.id)?.ip;

if (!ip) {
  console.error('Ampoule introuvable sur le reseau. Verifiez qu elle est alimentee,');
  console.error('ou passez son adresse en argument : node src/tools/probe.mjs 192.168.x.x');
  process.exit(1);
}

console.log('Ampoule : ' + device.name + ' (' + device.product_name + ', categorie ' + device.category + ')');
console.log('Cible   : ' + ip + '  id=' + device.id);
console.log('');

const bulb = new TuyAPI({ id: device.id, key: device.local_key, ip, version: '3.3' });

const started = Date.now();
await bulb.connect();
const status = await bulb.get({ schema: true });
const elapsed = Date.now() - started;
bulb.disconnect();

console.log('Connexion et lecture en ' + elapsed + ' ms, sans aucun cloud.');
console.log('');
console.log('Datapoints :');
for (const [dp, value] of Object.entries(status.dps).sort((a, b) => Number(a[0]) - Number(b[0]))) {
  console.log('  DP ' + dp.padStart(3) + ' = ' + JSON.stringify(value));
}
