/**
 * Dessin des faces de touche a la volee, en SVG.
 *
 * Ce que fait ce module : produire l'image d'une touche qui MONTRE l'etat au
 * lieu de l'ecrire. Une jauge qui se remplit, une goutte a la vraie couleur
 * choisie, un disque teinte a la vraie temperature de blanc.
 *
 * Pourquoi du SVG et pas du PNG : Stream Deck accepte une chaine SVG telle
 * quelle dans setImage. Aucune rasterisation, donc aucune dependance graphique
 * dans un plugin qui n'en avait pas besoin, et un rendu net a toutes les tailles
 * de materiel.
 *
 * La grammaire reprend celle des icones statiques (voir tools/make_icons.py) :
 * fond plein quasi noir, glyphe ambre remonte, valeur chiffree en bas. Les deux
 * doivent se ressembler, puisque l'une remplace l'autre a l'ecran.
 *
 * Invariant : ces fonctions sont PURES et n'importent RIEN. Elles ne lisent
 * rien, n'ecrivent rien, ne dependent d'aucun etat — ce qui les rend testables
 * sans ampoule ni Stream Deck, et c'est bien la moitie de leur interet.
 *
 * Corollaire assume : la couleur arrive deja en hexadecimal. Un module de dessin
 * parle en couleurs, pas en modele TSV ; la conversion appartient a l'action.
 *
 * Usage canonique :
 *   await action.setImage(brightnessKey(40, true));
 */
/** Cote du carre de dessin. Stream Deck met a l'echelle tout seul. */
const SIZE = 144;

const INK = '#0c0f15';
const AMBER = '#ffb247';
const DIM = '#5c6470';
const TEXT = '#e8eef6';

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** Point du cercle a un angle donne, en degres, y vers le bas comme en SVG. */
function polar(cx: number, cy: number, r: number, degrees: number): [number, number] {
  const a = (degrees * Math.PI) / 180;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
}

/**
 * Trace d'arc entre deux angles.
 *
 * Le drapeau « grand arc » se deduit de l'amplitude : au-dela de 180 degres, SVG
 * prendrait sinon le chemin le plus court, c'est-a-dire l'arc complementaire.
 */
export function arcPath(cx: number, cy: number, r: number, from: number, to: number): string {
  const [x1, y1] = polar(cx, cy, r, from);
  const [x2, y2] = polar(cx, cy, r, to);
  const large = Math.abs(to - from) > 180 ? 1 : 0;
  return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
}

/**
 * Couleur approchee d'un blanc a une temperature donnee.
 *
 * Approximation de Tanner Helland, largement utilisee : elle n'a pas la
 * rigueur d'une conversion colorimetrique, mais elle donne exactement ce qu'on
 * veut ici — un orange chaud vers 2700 K, un blanc bleute vers 6500 K, et une
 * transition credible entre les deux.
 */
export function kelvinToRgb(kelvin: number): string {
  const t = clamp(kelvin, 1000, 40000) / 100;

  const red = t <= 66 ? 255 : 329.698727446 * Math.pow(t - 60, -0.1332047592);
  const green = t <= 66
    ? 99.4708025861 * Math.log(t) - 161.1195681661
    : 288.1221695283 * Math.pow(t - 60, -0.0755148492);
  const blue = t >= 66 ? 255
    : t <= 19 ? 0
    : 138.5177312231 * Math.log(t - 10) - 305.0447927307;

  const byte = (v: number) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0');
  return '#' + byte(red) + byte(green) + byte(blue);
}

/**
 * Emballe un dessin pour `setImage`.
 *
 * Stream Deck documente accepter une chaine SVG brute, mais la forme data-URI
 * est celle qu'il traite depuis toujours, PNG comme SVG. On encode donc
 * systematiquement : c'est la forme la plus conservatrice, et elle ne coute rien.
 *
 * L'encodage n'est PAS cosmetique. Un dessin de touche est truffe de couleurs
 * `#rrggbb` ; dans une URI, le premier `#` ouvre le fragment et tout ce qui suit
 * est jete. Envoyee nue, l'image se retrouve tronquee des sa premiere couleur —
 * en silence, sans erreur ni journal, la touche gardant simplement son image
 * precedente. C'est exactement le symptome qu'on a passe deux correctifs a
 * chercher ailleurs.
 *
 * Usage canonique :
 *   await action.setImage(asImage(colorKey('#8b5cf6', true)));
 */
export function asImage(svg: string): string {
  return 'data:image/svg+xml;charset=utf8,' + encodeURIComponent(svg);
}

function frame(content: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">`
    + `<rect width="${SIZE}" height="${SIZE}" fill="${INK}"/>`
    + content
    + '</svg>';
}

function caption(text: string, color: string = TEXT): string {
  return `<text x="72" y="130" text-anchor="middle" font-family="Segoe UI, Helvetica, Arial, sans-serif"`
    + ` font-size="26" font-weight="600" fill="${color}">${text}</text>`;
}

/**
 * Jauge d'intensite : l'arc se remplit a proportion.
 *
 * L'aiguille de l'icone statique disparait ici — le remplissage porte deja
 * l'information, et deux indicateurs pour une seule valeur se contredisent des
 * qu'ils se desynchronisent.
 */
export function brightnessKey(percent: number, on: boolean): string {
  const pct = clamp(Math.round(percent), 0, 100);
  const color = on ? AMBER : DIM;
  const START = 140;
  const SWEEP = 260;

  const track = arcPath(72, 58, 40, START, START + SWEEP);
  const filled = arcPath(72, 58, 40, START, START + (SWEEP * pct) / 100);

  return frame(
    `<path d="${track}" fill="none" stroke="${color}" stroke-opacity="0.22" stroke-width="13" stroke-linecap="round"/>`
    + (pct > 0
      ? `<path d="${filled}" fill="none" stroke="${color}" stroke-width="13" stroke-linecap="round"/>`
      : '')
    + caption(on ? pct + ' %' : 'Eteinte', on ? TEXT : DIM),
  );
}

/** Goutte remplie de la couleur reellement appliquee, donnee en `#rrggbb`. */
export function colorKey(hex: string, on: boolean): string {
  const fill = on ? hex : DIM;
  // Goutte volontairement plus modeste que le premier jet : elle descendait
  // jusqu'a 120, ou le libelle de l'ampoule eteinte lui passait dessus. Elle
  // s'arrete maintenant a 108, et son poids visuel s'accorde aux autres glyphes.
  const drop = 'M 72 16 C 72 16, 104 54, 104 76 A 32 32 0 1 1 40 76 C 40 54, 72 16, 72 16 Z';

  // AUCUN libelle, meme eteinte. Une goutte grise dit deja tout, exactement
  // comme l'ampoule grise de la bascule ; le mot ne faisait qu'encombrer le bas
  // du dessin. La couleur est l'information, elle se passe de legende.
  // Le liisere emploie stroke-opacity, JAMAIS rgba() : Stream Deck rend le SVG
  // avec QSvg (SVG Tiny 1.2), qui suit CSS2 et ne connait donc que rgb(). Un
  // rgba() fait rejeter le document ENTIER, en silence — la touche garde alors
  // l'image du manifeste et parait figee, sans qu'aucun journal ne le signale.
  return frame(
    `<path d="${drop}" fill="${fill}" stroke="#ffffff" stroke-opacity="0.2" stroke-width="3"/>`,
  );
}

/**
 * Demi-disque teinte a la temperature reelle.
 *
 * La moitie pleine prend la couleur du blanc demande : on voit la chaleur au
 * lieu de la lire. Le nombre reste, parce que 3800 et 4200 K se ressemblent
 * beaucoup a l'oeil alors qu'ils ne se choisissent pas au hasard.
 */
export function temperatureKey(kelvin: number, on: boolean): string {
  const k = clamp(Math.round(kelvin), 2700, 6500);
  const tint = on ? kelvinToRgb(k) : DIM;
  const ring = on ? AMBER : DIM;

  return frame(
    `<circle cx="72" cy="58" r="38" fill="none" stroke="${ring}" stroke-width="10"/>`
    + `<path d="M 72 25 A 33 33 0 0 0 72 91 Z" fill="${tint}"/>`
    + caption(on ? k + ' K' : 'Eteinte', on ? TEXT : DIM),
  );
}

/**
 * Face d'un scenario : ce qu'il fait, et s'il tourne.
 *
 * Le glyphe dit l'ACTION QU'UN APPUI DECLENCHERA, pas l'etat courant : un
 * triangle quand la touche lancera le scenario, un carre quand elle l'arretera.
 * C'est la convention de tous les lecteurs, et elle evite l'ambiguite d'un
 * temoin qui laisserait deviner ce que l'appui va faire.
 *
 * Le nom est tronque plutot que reduit : un texte qui retrecit selon sa longueur
 * rend la serie de touches incoherente a l'oeil.
 */
export function scenarioKey(name: string, running: boolean): string {
  const color = running ? AMBER : DIM;
  const glyph = running
    ? '<rect x="52" y="34" width="40" height="40" rx="6" fill="' + color + '"/>'
    : '<path d="M 56 32 L 96 54 L 56 76 Z" fill="none" stroke="' + color + '" stroke-width="9" stroke-linejoin="round"/>';

  const label = name.length > 13 ? name.slice(0, 12) + '…' : name;
  return frame(
    glyph
    + '<text x="72" y="112" text-anchor="middle" font-family="Segoe UI, Helvetica, Arial, sans-serif"'
    + ' font-size="19" font-weight="600" fill="' + (running ? TEXT : DIM) + '">' + label + '</text>',
  );
}
