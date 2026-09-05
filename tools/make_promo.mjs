/**
 * Compose les visuels de presentation du plugin.
 *
 * Ce que fait ce script : produire deux pages HTML — une banniere et une planche
 * de touches — pretes a etre capturees en PNG.
 *
 * Choix non evident, et raison d'etre du script : les faces de touches ne sont
 * PAS redessinees pour l'occasion. Elles viennent de `src/key-art.ts`, le meme
 * module que le plugin appelle a l'execution. Une image promotionnelle dessinee
 * a part finit toujours par mentir : on la retouche, le produit evolue, et la
 * fiche montre quelque chose qui n'existe plus. Ici, un changement de dessin se
 * repercute au prochain rendu.
 *
 * Ce que le script ne peut pas faire, et qu'aucun rendu ne remplace : une
 * capture de l'application Stream Deck et une photo du materiel en situation.
 * Elles valent davantage sur une fiche, parce qu'elles montrent le produit dans
 * la vie plutot que sur fond noir.
 *
 * Usage canonique :
 *   node tools/make_promo.mjs      # ecrit promo/hero.html et promo/keys.html
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { brightnessKey, colorKey, scenarioKey, temperatureKey } from '../src/key-art.ts';

const RACINE = path.join(import.meta.dirname, '..', 'promo');
mkdirSync(RACINE, { recursive: true });

/**
 * Face de la bascule, lue depuis le PNG REELLEMENT livre.
 *
 * L'allumage est la seule action dont la face ne vient pas de key-art.ts : elle
 * a deux etats declares dans le manifeste, que Stream Deck echange lui-meme. Un
 * premier jet montrait une goutte a sa place — un visuel qui ment sur le
 * produit, precisement ce que ce script existe pour eviter.
 */
function faceLivree(nom) {
  const fichier = path.join(
    import.meta.dirname, '..', 'com.lumendeck.bulb.sdPlugin', 'imgs', 'actions', nom,
  );
  return '<img src="data:image/png;base64,' + readFileSync(fichier).toString('base64') + '" alt="">';
}

/** Fond du plugin, repris tel quel pour que la fiche et le produit s'accordent. */
const INK = '#0c0f15';
const AMBER = '#ffb247';
const TEXT = '#e8eef6';
const MUTED = '#8892a0';

const POLICE = '"Segoe UI", -apple-system, Helvetica, Arial, sans-serif';

/** Une touche, dessinee comme le materiel la montre : carree, coins arrondis. */
const touche = (svg, taille = 132) =>
  `<div class="key" style="width:${taille}px;height:${taille}px">${svg}</div>`;

const STYLE = `
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { background: ${INK}; font-family: ${POLICE}; color: ${TEXT}; overflow: hidden; }
  .key { border-radius: 14px; overflow: hidden; box-shadow: 0 10px 28px rgba(0,0,0,.55); }
  .key svg, .key img { width: 100%; height: 100%; display: block; }
  .deck { display: grid; grid-template-columns: repeat(3, auto); gap: 18px;
          padding: 26px; background: #1b1f27; border-radius: 22px;
          box-shadow: 0 30px 80px rgba(0,0,0,.6); }
`;

/**
 * Halo ambre derriere la scene.
 *
 * Le sujet du plugin est la lumiere : un fond parfaitement plat le dirait mal.
 * Le halo reste discret pour ne pas concurrencer les touches, qui sont
 * l'information.
 */
const HALO = `radial-gradient(1100px 620px at 72% 42%, rgba(255,178,71,.16), transparent 68%)`;

// --- Banniere ---------------------------------------------------------------
const hero = `<!doctype html><meta charset="utf-8"><style>${STYLE}
  /* justify-content: center — sans quoi le contenu se tasse a gauche et
     laisse un vide de 450 px a droite, que la capture rend flagrant. */
  .scene { width: 1920px; height: 1080px; display: flex; align-items: center;
           justify-content: center; gap: 120px; padding: 0 100px;
           background: ${HALO}, ${INK}; }
  h1 { font-size: 104px; letter-spacing: -2px; font-weight: 700; }
  .tag { font-size: 37px; color: ${AMBER}; margin-top: 16px; font-weight: 600; }
  ul { list-style: none; margin-top: 46px; }
  li { font-size: 29px; color: ${MUTED}; margin: 18px 0; padding-left: 36px; position: relative; }
  li::before { content: ''; position: absolute; left: 0; top: 11px; width: 13px; height: 13px;
               border-radius: 50%; background: ${AMBER}; }
</style>
<div class="scene">
  <div>
    <h1>LumenDeck</h1>
    <div class="tag">Your smart bulbs, on your Stream Deck</div>
    <ul>
      <li>Local control &mdash; no cloud, no account, ~23&nbsp;ms</li>
      <li>Keys that <em>show</em> their state, not just label it</li>
      <li>Eight light scenarios, from candle to sunrise</li>
      <li>Works with Tuya bulbs: Calex, Lidl, Nedis, Gosund&hellip;</li>
    </ul>
  </div>
  <div class="deck">
    ${touche(colorKey('#8b5cf6', true), 152)}
    ${touche(brightnessKey(72, true, 'Off'), 152)}
    ${touche(temperatureKey(2900, true, 'Off'), 152)}
    ${touche(scenarioKey('Candle', true), 152)}
    ${touche(colorKey('#22d3ee', true), 152)}
    ${touche(temperatureKey(6200, true, 'Off'), 152)}
  </div>
</div>`;

// --- Planche des cinq actions ----------------------------------------------
const ACTIONS = [
  ['Power', faceLivree(path.join('toggle', 'key-on@2x.png'))],
  ['Brightness', brightnessKey(45, true, 'Off')],
  ['Colour', colorKey('#3b82f6', true)],
  ['White', temperatureKey(4000, true, 'Off')],
  ['Scenario', scenarioKey('Sunrise', false)],
];

const keys = `<!doctype html><meta charset="utf-8"><style>${STYLE}
  .scene { width: 1600px; height: 900px; background: ${HALO}, ${INK};
           display: flex; flex-direction: column; align-items: center;
           justify-content: center; gap: 64px; }
  h2 { font-size: 46px; font-weight: 700; }
  .sub { font-size: 25px; color: ${MUTED}; margin-top: 12px; text-align: center; max-width: 900px; }
  .row { display: flex; gap: 46px; }
  figure { text-align: center; }
  figcaption { margin-top: 20px; font-size: 24px; color: ${TEXT}; font-weight: 600; }
</style>
<div class="scene">
  <div style="text-align:center">
    <h2>Five actions</h2>
    <div class="sub">Every face is drawn live from the bulb&rsquo;s real state &mdash;
      the gauge fills, the drop takes your colour, the disc warms up.</div>
  </div>
  <div class="row">
    ${ACTIONS.map(([nom, svg]) => `<figure>${touche(svg, 168)}<figcaption>${nom}</figcaption></figure>`).join('')}
  </div>
</div>`;

writeFileSync(path.join(RACINE, 'hero.html'), hero, 'utf8');
writeFileSync(path.join(RACINE, 'keys.html'), keys, 'utf8');
console.log('pages ecrites dans ' + RACINE);
