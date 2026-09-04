/**
 * Assemble le plugin en un bundle unique charge par Stream Deck.
 *
 * Calque sur le gabarit officiel de la CLI Elgato : la sortie va dans
 * `<uuid>.sdPlugin/bin/`, seul emplacement ou Stream Deck cherche le code, et un
 * `package.json` minimal y est emis pour que Node traite le bundle comme un
 * module ES. Le dossier `bin/` est ignore par git (artefact recompilable) ; c'est
 * le repertoire `.sdPlugin` lui-meme qui est versionne, car il porte le
 * manifeste et les images.
 */
import commonjs from '@rollup/plugin-commonjs';
import nodeResolve from '@rollup/plugin-node-resolve';
import terser from '@rollup/plugin-terser';
import typescript from '@rollup/plugin-typescript';
import path from 'node:path';
import url from 'node:url';

const isWatching = !!process.env.ROLLUP_WATCH;
const sdPlugin = 'com.lumendeck.bulb.sdPlugin';

/** @type {import('rollup').RollupOptions} */
export default {
  input: 'src/plugin.ts',
  output: {
    file: `${sdPlugin}/bin/plugin.js`,
    sourcemap: isWatching,
    sourcemapPathTransform: (rel, mapPath) =>
      url.pathToFileURL(path.resolve(path.dirname(mapPath), rel)).href,
  },
  plugins: [
    {
      name: 'watch-externals',
      buildStart() { this.addWatchFile(`${sdPlugin}/manifest.json`); },
    },
    typescript({ mapRoot: isWatching ? './' : undefined }),
    nodeResolve({ browser: false, exportConditions: ['node'], preferBuiltins: true }),
    commonjs(),
    !isWatching && terser(),
    {
      name: 'emit-module-package-file',
      generateBundle() {
        this.emitFile({ fileName: 'package.json', source: '{ "type": "module" }', type: 'asset' });
      },
    },
  ],
};
