/**
 * Panneau de la touche Ecran : repartition des couleurs, et ecran a suivre.
 *
 * Ce que fait ce script : dessiner le choix « meme couleur partout » ou « gauche /
 * droite de l'ecran », avec une phrase qui dit ce que cela change, et la liste des
 * ecrans que le capteur sait suivre. L'ordre des ampoules se regle dans la liste
 * du dessus (bulbs.js, `data-ordered`) : de gauche a droite dans la piece.
 *
 * Choix non evidents :
 *   - « Ecran principal » (`primary`) est le defaut et reste propose meme si la
 *     liste des ecrans est vide : le capteur sait le retrouver tout seul, et un
 *     panneau qui bloquerait sur une liste vide empecherait de s'en servir.
 *   - Les reglages s'ecrivent par `SDPIComponents.useSettings`, comme le reste de
 *     la page, pour partager le meme stockage (voir bulbs.js).
 */
(() => {
  const ui = window.LumenDeckUI;
  const modeAnchor = document.getElementById('screen-mode');
  const monitorAnchor = document.getElementById('screen-monitor');
  if (!ui || !modeAnchor || !monitorAnchor) return;
  const { tr, el, sdpi, send, client } = ui;

  let mode = 'same';
  let screen = 'primary';
  /** Ecrans connus du capteur, ou null tant qu'il n'a pas repondu. */
  let screens = null;

  const [, setMode] = sdpi.useSettings('mode', (value) => { mode = value === 'zones' ? 'zones' : 'same'; render(); }, 0);
  const [, setScreen] = sdpi.useSettings('screen', (value) => { screen = typeof value === 'string' && value ? value : 'primary'; render(); }, 0);

  const tile = (pressed, text, onclick) => el('button', { type: 'button', class: 'ld-tile wide', 'aria-pressed': String(pressed), text, onclick });

  function render() {
    modeAnchor.classList.add('ld');
    modeAnchor.replaceChildren(el('section', { class: 'ld-section' },
      el('h2', { class: 'ld-title', text: tr('pi.screenMode', 'Colours') }),
      el('div', { class: 'ld-tiles' },
        tile(mode === 'same', tr('pi.screenSame', 'Same everywhere'), () => { mode = 'same'; setMode(mode); render(); }),
        tile(mode === 'zones', tr('pi.screenZones', 'Left / right'), () => { mode = 'zones'; setMode(mode); render(); })),
      el('p', { class: 'ld-note', text: mode === 'zones'
        ? tr('pi.screenZonesNote', 'The first bulbs follow the left half of the screen, the last ones the right half. Put the bulbs in order, from left to right, with the arrows above.')
        : tr('pi.screenSameNote', 'Every bulb takes the dominant colour of the whole screen.') })));

    const choices = [{ value: 'primary', label: tr('pi.screenMain', 'Main screen') }]
      .concat((screens ?? []).map((s) => ({ value: String(s.index), label: s.label + (s.primary ? ' ★' : '') })));
    monitorAnchor.classList.add('ld');
    monitorAnchor.replaceChildren(el('section', { class: 'ld-section' },
      el('h2', { class: 'ld-title', text: tr('pi.screenMonitor', 'Screen to follow') }),
      el('div', { class: 'ld-tiles' }, choices.map((c) => tile(screen === c.value, c.label, () => { screen = c.value; setScreen(screen); render(); }))),
      screens !== null && screens.length === 0
        ? el('p', { class: 'ld-note ld-err', text: tr('pi.screenNoCapture', 'The screen capture tool is not installed. Run "npm run build:capture", then restart Stream Deck.') })
        : null));
  }

  client.sendToPropertyInspector.subscribe((event) => {
    const payload = event?.payload;
    if (!payload || payload.event !== 'getScreens') return;
    screens = Array.isArray(payload.items) ? payload.items : [];
    render();
  });

  ui.onLocale(render);
  render();
  send({ event: 'getScreens' });
})();
