/**
 * Diagnostic de la recherche d'ampoules.
 *
 * Ce que fait cet outil : distinguer les trois causes possibles quand la
 * recherche ne trouve rien, alors qu'elles produisent toutes le meme symptome.
 *
 *   1. L'ampoule ne parle pas — eteinte au disjoncteur, ou hors reseau.
 *   2. Elle parle mais on ne l'entend pas — un pare-feu jette les annonces, qui
 *      arrivent en UDP ENTRANT. Symptome trompeur : les commandes, elles,
 *      partent en TCP sortant et fonctionnent parfaitement.
 *   3. Elle parle sur un autre reseau — les diffusions ne franchissent pas un
 *      routeur. Un ordinateur en filaire et une ampoule sur un wifi invite ne
 *      s'entendront jamais, meme avec tous les pare-feu ouverts.
 *
 * Le test TCP est ce qui separe le cas 1 des deux autres : il emprunte le sens
 * sortant, insensible au pare-feu entrant.
 *
 * Usage :
 *   node src/tools/diagnose.mjs                 # ecoute seulement
 *   node src/tools/diagnose.mjs 192.168.1.42    # ecoute et teste cette ampoule
 */
import dgram from 'node:dgram';
import net from 'node:net';
import os from 'node:os';

const TARGET = process.argv[2];
const LISTEN_MS = 10000;
const TUYA_PORT = 6668;

function section(title) {
  console.log('');
  console.log('=== ' + title + ' ===');
}

/** Adresses IPv4 locales, pour reperer un ordinateur sur un autre sous-reseau. */
function interfaces() {
  const found = [];
  for (const [name, addresses] of Object.entries(os.networkInterfaces())) {
    for (const a of addresses ?? []) {
      if (a.family === 'IPv4' && !a.internal) found.push({ name, address: a.address });
    }
  }
  return found;
}

/** Les deux premieres composantes d'une adresse, suffisantes pour comparer. */
const subnet = (ip) => ip.split('.').slice(0, 3).join('.');

function tcpProbe(ip) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const started = Date.now();
    socket.setTimeout(4000);
    socket.on('connect', () => { socket.destroy(); resolve({ ok: true, ms: Date.now() - started }); });
    socket.on('timeout', () => { socket.destroy(); resolve({ ok: false, reason: 'delai depasse' }); });
    socket.on('error', (e) => resolve({ ok: false, reason: e.code ?? e.message }));
    socket.connect(TUYA_PORT, ip);
  });
}

function listen() {
  return new Promise((resolve) => {
    const report = { frames: 0, sources: new Set(), errors: [] };
    const sockets = [];

    for (const port of [6666, 6667]) {
      const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
      socket.on('error', (e) => report.errors.push(port + ' : ' + (e.code ?? e.message)));
      socket.on('listening', () => console.log('  port ' + port + ' en ecoute'));
      socket.on('message', (_msg, rinfo) => { report.frames++; report.sources.add(rinfo.address); });
      socket.bind(port);
      sockets.push(socket);
    }

    setTimeout(() => {
      for (const s of sockets) { try { s.close(); } catch { /* deja ferme */ } }
      resolve(report);
    }, LISTEN_MS);
  });
}

section('Interfaces reseau de cet ordinateur');
const nics = interfaces();
if (nics.length === 0) console.log('  aucune interface IPv4 active');
for (const n of nics) console.log('  ' + n.address.padEnd(16) + n.name);

if (TARGET) {
  section("L'ampoule repond-elle ? (TCP sortant, insensible au pare-feu entrant)");
  const probe = await tcpProbe(TARGET);
  if (probe.ok) {
    console.log('  OUI, en ' + probe.ms + ' ms. Elle est alimentee et joignable.');
  } else {
    console.log('  NON : ' + probe.reason);
  }

  const shared = nics.some((n) => subnet(n.address) === subnet(TARGET));
  console.log('  Meme sous-reseau qu une de vos interfaces : ' + (shared ? 'oui' : 'NON'));
  if (!shared) {
    console.log('  -> Les diffusions ne franchissent pas un routeur. C est la cause.');
  }
}

section('Ecoute des annonces (10 secondes)');
const report = await listen();
for (const e of report.errors) console.log('  erreur de liaison ' + e);
console.log('  trames recues : ' + report.frames);
for (const src of report.sources) console.log('    depuis ' + src);

section('Verdict');
if (report.errors.length > 0) {
  console.log('  Un port n a pas pu etre ouvert : un autre logiciel l occupe deja');
  console.log('  (une application Tuya, ou une seconde instance de cet outil).');
} else if (report.frames > 0) {
  console.log('  Les annonces arrivent. La recherche devrait fonctionner depuis ce');
  console.log('  programme. Si elle echoue depuis Stream Deck, c est que le pare-feu');
  console.log('  autorise Node mais pas Stream Deck : les regles sont par binaire.');
} else if (TARGET) {
  console.log('  Aucune annonce recue. Si le test TCP ci-dessus a reussi, l ampoule');
  console.log('  parle mais ses annonces sont jetees : cherchez une regle de pare-feu');
  console.log('  ENTRANTE bloquant ce programme. Une regle de blocage l emporte');
  console.log('  toujours sur une autorisation, meme creee ensuite.');
} else {
  console.log('  Aucune annonce recue. Relancez en donnant l adresse de l ampoule');
  console.log('  pour distinguer une ampoule muette d un pare-feu trop zele.');
}
console.log('');
