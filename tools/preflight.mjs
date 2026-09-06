/**
 * Controle de la chaine de developpement, avant build ou deploiement.
 *
 * Ce que fait ce script : verifier que ce dont la commande suivante a besoin est
 * la, ET joignable, puis dire quoi faire quand ce n'est pas le cas.
 *
 * LE CHOIX NON EVIDENT, ET LA RAISON D'ETRE DU SCRIPT : quand `rollup` manque,
 * npm laisse cmd.exe repondre « n'est pas reconnu en tant que commande interne
 * ou externe ». Ce message ne dit ni quel maillon manque, ni quoi lancer pour le
 * reparer. Pire, il recouvre DEUX pannes distinctes aux remedes opposes :
 *
 *   1. le binaire n'est pas installe        -> `npm install`
 *   2. il est installe mais hors du PATH    -> npm n'a pas prefixe node_modules/.bin
 *      dans CE shell ; reouvrir le terminal, ou appeler le binaire par son chemin.
 *
 * Le second cas est le plus deroutant : le fichier est bien sur le disque, on le
 * voit, et la commande echoue quand meme. C'est pourquoi le PATH est inspecte
 * explicitement plutot que deduit de l'absence du fichier.
 *
 * POURQUOI PAS UN LANCEMENT REEL : executer `rollup --version` trancherait tout
 * seul, mais couterait quelques centaines de millisecondes a chaque build. Deux
 * lectures de repertoire donnent le meme verdict pour un cout nul.
 *
 * SILENCIEUX QUAND TOUT VA BIEN : un controle qui parle a chaque build devient un
 * bruit qu'on cesse de lire, et le jour ou il a quelque chose a dire, personne ne
 * le voit passer.
 *
 * N'importe QUE des modules natifs : il doit precisement pouvoir s'executer quand
 * les dependances manquent.
 *
 * Usage :
 *   node tools/preflight.mjs                  # dependances installees ?
 *   node tools/preflight.mjs rollup           # ... et rollup joignable ?
 *   node tools/preflight.mjs streamdeck       # ... et le CLI Elgato joignable ?
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MODULES = path.join(RACINE, 'node_modules');
const BIN = path.join(MODULES, '.bin');

/** Suffixes des lanceurs poses par npm. Vide sur Unix, .cmd/.ps1 sur Windows. */
const SUFFIXES = ['', '.cmd', '.exe', '.ps1'];

const problemes = [];

/** Normalise un chemin pour comparer deux entrees de PATH sous Windows. */
const memeChemin = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();

/**
 * node_modules/.bin figure-t-il dans le PATH herite de npm ?
 *
 * Ne se pose QUE sous npm : c'est npm qui prefixe ce repertoire, et lui seul.
 * Appele a la main (`node tools/preflight.mjs`), le PATH ne le contient
 * legitimement pas, et le signaler serait une fausse alerte.
 */
function binDansPath() {
  if (!process.env.npm_lifecycle_event) return true;
  const brut = process.env.PATH ?? process.env.Path ?? '';
  return brut.split(path.delimiter).some((entree) => entree && memeChemin(entree, BIN));
}

/** Version majeure exigee par le champ engines, ou null s'il n'en declare pas. */
function majeureExigee() {
  try {
    const manifeste = JSON.parse(fs.readFileSync(path.join(RACINE, 'package.json'), 'utf8'));
    const trouve = /(\d+)/.exec(manifeste.engines?.node ?? '');
    return trouve ? Number(trouve[1]) : null;
  } catch {
    return null; // Sans manifeste lisible, on ne bloque pas : d'autres controles suivront.
  }
}

// --- 1. Version de Node ------------------------------------------------------
const exigee = majeureExigee();
const courante = Number(process.versions.node.split('.')[0]);
if (exigee !== null && courante < exigee) {
  problemes.push(
    'Node ' + process.versions.node + ' est trop ancien (le projet exige >= ' + exigee + ').\n' +
    '  -> installez Node ' + exigee + ' ou plus recent, puis relancez.',
  );
}

// --- 2. Dependances installees ----------------------------------------------
if (!fs.existsSync(MODULES)) {
  problemes.push('Les dependances ne sont pas installees.\n  -> npm install');
} else {
  // --- 3. Binaires demandes --------------------------------------------------
  for (const nom of process.argv.slice(2)) {
    const surDisque = SUFFIXES.some((suffixe) => fs.existsSync(path.join(BIN, nom + suffixe)));

    if (!surDisque) {
      problemes.push(
        '« ' + nom + ' » est absent de node_modules/.bin.\n' +
        '  -> npm install   (le paquet manque, ou l installation a ete interrompue)',
      );
    } else if (!binDansPath()) {
      problemes.push(
        '« ' + nom + ' » est bien installe, mais node_modules/.bin ne figure pas dans le PATH\n' +
        '  de ce shell — npm ne l a pas prefixe. La commande echouera sur un\n' +
        '  « n est pas reconnu » trompeur.\n' +
        '  -> reouvrez le terminal, ou appelez le binaire par son chemin :\n' +
        '     .' + path.sep + path.relative(RACINE, path.join(BIN, nom)),
      );
    }
  }
}

if (problemes.length > 0) {
  console.error('');
  console.error('Preflight LumenDeck : la commande ne peut pas aboutir.');
  for (const probleme of problemes) console.error('\n  ' + probleme);
  console.error('');
  process.exit(1);
}
