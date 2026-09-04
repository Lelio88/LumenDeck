/**
 * Sonde de diagnostic : lit l'etat d'une ampoule en LAN via tuyapi.
 *
 * Sert a deux choses : verifier qu'une local_key est valide, et relever la
 * cartographie des DPS d'un nouveau modele avant d'ecrire son profil de pilote.
 * Lit l'inventaire depuis le coffre hors depot (voir ../.lumendeck-secrets/).
 */
import { readFileSync } from 'node:fs';
import TuyAPI from 'tuyapi';

const VAULT = 'C:/Users/buton/Documents/Projets/.lumendeck-secrets/tuya-devices.csv';
const LAN_IP = process.argv[2] ?? '192.168.1.50';

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
console.log(`Ampoule : ${device.name} (${device.product_name})`);
console.log(`Cible   : ${LAN_IP}  id=${device.id}\n`);

const bulb = new TuyAPI({ id: device.id, key: device.local_key, ip: LAN_IP, version: '3.3' });

const t0 = Date.now();
await bulb.connect();
const status = await bulb.get({ schema: true });
const ms = Date.now() - t0;
bulb.disconnect();

console.log(`tuyapi : connexion + lecture en ${ms} ms\n`);
console.log('Datapoints :');
for (const [dp, val] of Object.entries(status.dps).sort((a, b) => +a[0] - +b[0])) {
  console.log(`  DP ${dp.padStart(3)} = ${JSON.stringify(val)}`);
}
