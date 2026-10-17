/**
 * Panneau de la touche Scenario : choix du scenario, et « les ampoules jouent ensemble ».
 *
 * Ce que fait ce script : dessiner les scenarios en tuiles, et la case qui fait
 * jouer aux ampoules la version de groupe du scenario, avec une phrase qui dit
 * ce que cela change pour CE scenario. L'ordre des ampoules est regle par la
 * liste du dessus (bulbs.js, `data-ordered`).
 *
 * Choix non evident : les reglages s'ecrivent par `SDPIComponents.useSettings`,
 * comme le reste de la page, pour partager le meme stockage (voir bulbs.js).
 * Les identifiants des scenarios sont ceux du catalogue du plugin
 * (src/scenarios/catalogue.ts) : un scenario ajoute la-bas doit l'etre ici.
 */
(() => {
  const ui = window.LumenDeckUI;
  const picker = document.getElementById('scenario-panel');
  const togetherAnchor = document.getElementById('scenario-together');
  if (!ui || !picker || !togetherAnchor) return;
  const { tr, el, sdpi } = ui;

  /** Ordre d'affichage, et nom anglais de repli si le dictionnaire manque. */
  const SCENARIOS = [
    ['clignotement', 'Blink'], ['gyrophare', 'Police lights'], ['respiration', 'Breathing'], ['bougie', 'Candle'],
    ['orage', 'Storm'], ['arc-en-ciel', 'Rainbow'], ['alerte', 'Alert'], ['lever-de-soleil', 'Sunrise'],
  ];

  let scenarioId;
  let together = false;
  const [getScenario, setScenario] = sdpi.useSettings('scenarioId', (value) => { scenarioId = value; render(); }, 0);
  const [getTogether, setTogether] = sdpi.useSettings('together', (value) => { together = value === true; render(); }, 0);

  function render() {
    picker.classList.add('ld');
    picker.replaceChildren(el('section', { class: 'ld-section', style: 'margin-top: 0' },
      el('h2', { class: 'ld-title', text: tr('pi.scenario', 'Scenario') }),
      el('div', { class: 'ld-tiles' }, SCENARIOS.map(([id, english]) => el('button', {
        type: 'button', class: 'ld-tile', 'aria-pressed': String(id === scenarioId),
        text: tr('scenario.' + id + '.name', english),
        onclick: () => { scenarioId = id; setScenario(id); render(); },
      })))));

    const explain = together && scenarioId
      ? tr('scenario.' + scenarioId + '.together', 'The light travels from one bulb to the next.')
      : tr('pi.scenarioAlone', 'Every bulb plays the scenario on its own, all at the same time.');
    togetherAnchor.classList.add('ld');
    togetherAnchor.replaceChildren(el('section', { class: 'ld-section' },
      el('div', { class: 'ld-box' },
        el('label', { class: 'ld-check' },
          el('input', { type: 'checkbox', checked: together, onchange: (e) => { together = e.target.checked; setTogether(together); render(); } }),
          el('span', { class: 'ld-name', style: 'font-weight: 600', text: tr('pi.together', 'The bulbs play together') })),
        el('p', { class: 'ld-note', style: 'opacity: .85', text: explain }))));
  }

  Promise.all([getScenario(), getTogether()]).then(([id, both]) => { scenarioId = id; together = both === true; render(); }, render);
  ui.onLocale(render);
  render();
})();
