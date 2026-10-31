/**
 * Compile le capteur d'ecran (Rust) et le range dans le dossier du plugin.
 *
 * Ce que fait ce script : lancer `cargo build --release` sur tools/lumendeck-capture,
 * puis copier l'executable a cote de bin/plugin.js, la seule place ou le plugin le
 * cherche (voir src/screen/runner.ts).
 *
 * Choix non evident : le capteur n'est PAS dans la chaine `npm run build`. Rust est
 * une dependance de developpement en plus ; ceux qui ne touchent pas au suivi
 * d'ecran n'ont pas a l'installer, et un `cargo` absent ne doit pas casser le
 * build du plugin. Sans capteur, la touche « Ecran » dit simplement qu'il manque.
 *
 * N'importe QUE des modules natifs.
 *
 * Usage : npm run build:capture
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CRATE = path.join(RACINE, 'tools', 'lumendeck-capture');
const BUILT = path.join(CRATE, 'target', 'release', 'lumendeck-capture.exe');
const DEST = path.join(RACINE, 'com.lumendeck.bulb.sdPlugin', 'bin', 'lumendeck-capture.exe');

const version = spawnSync('cargo', ['--version'], { encoding: 'utf8' });
if (version.status !== 0) {
  console.error([
    '',
    'Build du capteur : « cargo » est introuvable.',
    '  -> winget install Rustlang.Rustup',
    '     puis rouvrez le terminal. Il faut aussi les Build Tools de Visual Studio',
    '     (charge de travail « Developpement Desktop en C++ »), que rustup signale s ils manquent.',
    '',
  ].join('\n'));
  process.exit(1);
}

const build = spawnSync('cargo', ['build', '--release', '--manifest-path', path.join(CRATE, 'Cargo.toml')], {
  stdio: 'inherit',
});
if (build.status !== 0) process.exit(build.status ?? 1);

fs.mkdirSync(path.dirname(DEST), { recursive: true });
fs.copyFileSync(BUILT, DEST);
console.log('Capteur installe : ' + path.relative(RACINE, DEST));
