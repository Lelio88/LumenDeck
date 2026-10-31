/**
 * Essai : l'ampoule sait-elle faire un fondu MATERIEL entre deux couleurs ?
 *
 * Ce que fait ce script : envoie a une ampoule reelle, en LAN, un meme changement de
 * couleur (rouge -> bleu) de trois facons differentes, en vous demandant de regarder
 * si elle FOND ou si elle SAUTE. Rien d'automatique ne peut le dire : c'est l'oeil
 * qui juge.
 *
 * Pourquoi : les ampoules Tuya appliquent une couleur d'un coup, la ou Philips Hue
 * joint un temps de transition a chaque ordre. Les documentations Tuya decrivent
 * pourtant, pour le mode « musique » (datapoint 27), une chaine
 *   [mode 1 car.][teinte 4][saturation 4][valeur 4][luminosite 4][temperature 4]
 * ou le mode vaut 0 (saut) ou 1 (degrade). Si l'ampoule l'accepte en LAN, le suivi
 * d'ecran peut lui laisser faire le fondu entre deux envois.
 *
 * CE QUE C'EST : une EXPERIENCE. Les documentations se contredisent sur le sens du
 * mode, et rien ne garantit qu'un modele donne reponde. Ne rien deduire d'un essai
 * sans l'avoir vu a l'ecran. L'ampoule est remise dans son etat d'avant a la fin.
 *
 * Meme principe que probe.mjs : l'adresse est decouverte, le coffre se lit hors
 * depot (`LUMENDECK_VAULT` pour le deplacer), rien de personnel n'est ecrit ici.
 *
 * Usage :
 *   npm run probe:fade                  # decouvre l'adresse
 *   npm run probe:fade -- 192.168.1.42  # impose une adresse
 *   LUMENDECK_PROTOCOL=3.4 npm run probe:fade   # si l'ampoule parle 3.4
 */
import { readFileSync } from 'node:fs';

import TuyAPI from 'tuyapi';

import { discover } from '../discovery.ts';
import { encodeColor } from '../driver/tuya.ts';

const VAULT = process.env.LUMENDECK_VAULT ?? '../.lumendeck-secrets/tuya-devices.csv';
const PROTOCOL = process.env.LUMENDECK_PROTOCOL ?? '3.3';
const DP = { power: '20', mode: '21', color: '24', music: '27' };

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Analyse CSV minimale (champs quotes compris), suffisante pour l'inventaire. */
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

/** Chaine du datapoint 27 : mode, puis teinte, saturation, valeur, luminosite, temperature, sur 4 hex chacun. */
function musicData(mode, { h, s, v }) {
  const hex = (n) => Math.max(0, Math.min(0xffff, Math.round(n))).toString(16).padStart(4, '0');
  return String(mode) + hex(h) + hex(s * 10) + hex(v * 10) + hex(1000) + hex(0);
}

const [device] = parseCsv(readFileSync(VAULT, 'utf8'));
if (!device) {
  console.error('Coffre vide ou illisible : ' + VAULT);
  process.exit(1);
}
const ip = process.argv[2] ?? process.env.LUMENDECK_IP ?? (await discover(7000)).find((b) => b.id === device.id)?.ip;
if (!ip) {
  console.error('Ampoule introuvable sur le reseau : alimentee ? sinon, passez son adresse en argument.');
  process.exit(1);
}

const RED = { h: 0, s: 100, v: 100 };
const BLUE = { h: 240, s: 100, v: 100 };

const bulb = new TuyAPI({ id: device.id, key: device.local_key, ip, version: PROTOCOL });
bulb.on('error', () => undefined);
await bulb.connect();

const before = (await bulb.get({ schema: true })).dps ?? {};
console.log('Ampoule : ' + device.name + ' (' + device.product_name + ')  ' + ip + '  protocole ' + PROTOCOL);
console.log('Datapoint 27 (musique) annonce par l\'ampoule : ' + (DP.music in before ? 'OUI' : 'non (l\'essai peut etre sans effet)'));
console.log('Datapoints lus : ' + Object.keys(before).join(', '));
console.log('');

/** Remet l'ampoule en rouge, bien en mode couleur, avant chaque essai. */
async function reset() {
  await bulb.set({ multiple: true, data: { [DP.power]: true, [DP.mode]: 'colour', [DP.color]: encodeColor(RED) } });
  await wait(2500);
}

const trials = [
  {
    name: 'A. datapoint 27 en degrade, mode COULEUR conserve',
    run: () => bulb.set({ dps: Number(DP.music), set: musicData(1, BLUE) }),
  },
  {
    name: 'B. mode MUSIQUE + datapoint 27 en degrade (mode 1)',
    run: () => bulb.set({ multiple: true, data: { [DP.mode]: 'music', [DP.music]: musicData(1, BLUE) } }),
  },
  {
    name: 'C. mode MUSIQUE + datapoint 27 en saut (mode 0), pour comparer',
    run: () => bulb.set({ multiple: true, data: { [DP.mode]: 'music', [DP.music]: musicData(0, BLUE) } }),
  },
];

for (const trial of trials) {
  await reset();
  console.log(trial.name);
  console.log('  -> regardez : la lampe va passer du rouge au bleu. FONDU, SAUT, ou RIEN ?');
  try {
    await trial.run();
  } catch (error) {
    console.log('  (refus de l\'ampoule : ' + (error instanceof Error ? error.message : String(error)) + ')');
  }
  await wait(4000);
  console.log('');
}

// Remettre l'ampoule exactement comme on l'a trouvee.
const restore = { [DP.power]: before[DP.power] ?? true };
if (before[DP.mode] !== undefined) restore[DP.mode] = before[DP.mode];
if (before[DP.color] !== undefined) restore[DP.color] = before[DP.color];
await bulb.set({ multiple: true, data: restore });
await wait(500);
bulb.disconnect();
console.log('Ampoule remise dans son etat d\'avant. Notez, pour chaque essai : fondu, saut ou rien.');
