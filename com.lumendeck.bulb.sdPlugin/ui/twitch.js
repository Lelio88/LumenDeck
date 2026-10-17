/**
 * Panneau de la touche Twitch : connexion du compte, recompenses proposees aux
 * viewers, et derniers rachats.
 *
 * Ce que fait ce script : afficher l'etat que le plugin envoie (`twitchStatus`),
 * transmettre les gestes (connecter, annuler, mettre en pause, reessayer,
 * deconnecter), et ecrire les choix des recompenses dans les reglages de la
 * touche : couleurs de la palette, couleur surprise, saisie libre, scenarios,
 * duree selon le prix, « les ampoules jouent ensemble ».
 *
 * Choix non evidents :
 *
 *   - Le panneau ne decide RIEN cote Twitch : il ecrit des reglages, et le plugin
 *     cree ou supprime les recompenses en consequence (twitch/service.ts). Un
 *     panneau qu'on ferme en plein appairage ne l'interrompt pas.
 *
 *   - Les reglages s'ecrivent par `SDPIComponents.useSettings`, comme le reste de
 *     la page (voir bulbs.js). Les valeurs par defaut reprennent DEFAULT_CONFIG
 *     de src/twitch/rewards.ts : les deux doivent rester d'accord, sinon le
 *     panneau montrerait cochee une recompense qui n'existe pas.
 *
 *   - Rien de secret n'arrive ici : le plugin n'envoie que l'etat. Le nom d'un
 *     viewer et ce qu'il a tape viennent d'inconnus : ils passent par
 *     `textContent`, jamais par du HTML.
 */
(() => {
  const ui = window.LumenDeckUI;
  const statusAnchor = document.getElementById('tw-status');
  const configAnchor = document.getElementById('tw-config');
  const historyAnchor = document.getElementById('tw-history');
  const leaveAnchor = document.getElementById('tw-leave');
  if (!ui || !statusAnchor || !configAnchor || !historyAnchor || !leaveAnchor) return;
  const { tr, el, send, client, sdpi } = ui;

  /** Doit rester identique a DEFAULT_CONFIG (src/twitch/rewards.ts). */
  const DEFAULTS = {
    colors: ['rouge', 'vert', 'bleu', 'violet', 'rose'],
    surprise: true,
    freeText: true,
    scenarios: ['gyrophare', 'respiration', 'bougie', 'orage', 'arc-en-ciel'],
    secondsPer100: 10,
    maxSeconds: 60,
    together: true,
  };
  /** Couleurs de la palette ; la teinte ne sert qu'a l'affichage. Memes identifiants que PALETTE. */
  const PALETTE = [
    ['rouge', 'Red', '#ff3b30'], ['orange', 'Orange', '#ff8a00'], ['jaune', 'Yellow', '#ffd60a'],
    ['vert', 'Green', '#34c759'], ['cyan', 'Cyan', '#32d7e6'], ['bleu', 'Blue', '#2f6bff'],
    ['violet', 'Purple', '#9b51e0'], ['rose', 'Pink', '#ff6fae'], ['blanc', 'White', '#f4f4f4'],
  ];
  const SCENARIOS = [
    ['clignotement', 'Blink'], ['gyrophare', 'Police lights'], ['respiration', 'Breathing'], ['bougie', 'Candle'],
    ['orage', 'Storm'], ['arc-en-ciel', 'Rainbow'], ['alerte', 'Alert'], ['lever-de-soleil', 'Sunrise'],
  ];
  /** Scenarios qui clignotent : signales, pas interdits (choix du streamer). */
  const FLASHING = new Set(['clignotement', 'gyrophare', 'alerte']);
  /** Les pannes dont le texte existe ; les autres retombent sur le message generique. */
  const ERRORS = ['network', 'expired', 'rejected', 'missing-scope', 'reconnect-needed', 'revoked', 'forbidden', 'duplicate'];
  const ALIAS = { unauthorized: 'reconnect-needed' };

  let status = null;
  const config = { ...DEFAULTS };
  const setters = {};
  for (const key of Object.keys(DEFAULTS)) {
    const [get, set] = sdpi.useSettings(key, (value) => { config[key] = value ?? DEFAULTS[key]; renderConfig(); }, 0);
    setters[key] = set;
    get().then((value) => { if (value !== undefined) { config[key] = value; renderConfig(); } }, () => undefined);
  }
  const change = (key, value) => { config[key] = value; setters[key](value); renderConfig(); };
  const toggleIn = (key, id) => change(key, config[key].includes(id) ? config[key].filter((x) => x !== id) : [...config[key], id]);

  const title = (key, english) => el('h2', { class: 'ld-title', text: tr(key, english) });
  const section = (...children) => el('section', { class: 'ld-section' }, ...children);

  // --- Etat ------------------------------------------------------------------

  function problemLine(problem) {
    const code = ALIAS[problem] || problem;
    const known = ERRORS.includes(code);
    return el('p', { class: 'ld-note ld-err', text: tr('pi.twitch.err.' + (known ? code : 'generic'), 'Something went wrong. Try again.') });
  }

  function renderStatus() {
    statusAnchor.classList.add('ld');
    if (!status) { statusAnchor.replaceChildren(); return; }
    const link = status.link;
    const parts = [];

    if (link === 'disconnected' || link === 'auth-needed') {
      parts.push(
        el('p', { class: 'ld-note', style: 'opacity: .85', text: tr('pi.twitch.intro', 'Viewers spend channel points to change your bulbs. Connect your Twitch account once: LumenDeck creates the rewards itself.') }),
        el('div', { class: 'ld-line' }, el('button', { type: 'button', class: 'ld-primary', text: tr('pi.twitch.connect', 'Connect Twitch'), onclick: () => send({ event: 'twitchConnect' }) })));
    } else if (link === 'pairing') {
      parts.push(
        el('p', { class: 'ld-note', style: 'opacity: .85', text: tr('pi.twitch.pairing', 'Check this code on the Twitch page that just opened:') }),
        el('div', { class: 'ld-code', text: status.pairing ? status.pairing.userCode : '' }),
        el('p', { class: 'ld-note', text: tr('pi.twitch.waiting', 'Waiting for your approval on Twitch...') }),
        el('div', { class: 'ld-line' }, el('button', { type: 'button', text: tr('pi.twitch.cancel', 'Cancel'), onclick: () => send({ event: 'twitchCancel' }) })));
    } else {
      const live = link === 'online' && !status.paused;
      const line = status.paused ? tr('pi.twitch.pausedLine', 'Paused · redemptions are refunded')
        : link === 'online' ? tr('pi.twitch.liveLine', 'Live · viewers are in control')
          : link === 'problem' ? tr('pi.twitch.blockedLine', 'Blocked')
            : tr('pi.twitch.connecting', 'Connecting…');
      parts.push(el('div', { class: 'ld-box' },
        el('div', { class: 'ld-spread' },
          el('span', { class: 'ld-line', style: 'font-weight: 600' },
            el('span', { class: 'ld-dot' + (live ? ' on' : link === 'problem' ? ' off' : '') }),
            el('span', { text: line })),
          link === 'online' ? el('button', {
            type: 'button', class: status.paused ? 'ld-primary' : '',
            text: status.paused ? tr('pi.twitch.resume', 'Resume') : tr('pi.twitch.pause', 'Pause'),
            onclick: () => send({ event: 'twitchPause' }),
          }) : null,
          link === 'problem' ? el('button', { type: 'button', text: tr('pi.twitch.retry', 'Try again'), onclick: () => send({ event: 'twitchRetry' }) }) : null),
        el('p', { class: 'ld-note' },
          el('span', { text: tr('pi.twitch.connectedAs', 'Connected as') + ' ' }),
          el('strong', { text: status.login || '' }),
          el('span', { text: '. ' + tr('pi.twitch.keyPause', 'The Stream Deck key does the same as this button.') }))));
    }
    if (status.problem) parts.push(problemLine(status.problem));
    statusAnchor.replaceChildren(el('section', { class: 'ld-section', style: 'margin-top: 0' }, ...parts));
  }

  // --- Recompenses -------------------------------------------------------------

  function stepper(label, value, unit, onLess, onMore) {
    return el('div', { class: 'ld-spread' },
      el('span', { style: 'opacity: .8', text: label }),
      el('div', { class: 'ld-stepper' },
        el('button', { type: 'button', class: 'ld-icon', 'aria-label': tr('pi.twitch.less', 'Less'), text: '−', onclick: onLess }),
        el('output', { class: 'ld-mono', text: value + unit }),
        el('button', { type: 'button', class: 'ld-icon', 'aria-label': tr('pi.twitch.more', 'More'), text: '+', onclick: onMore })));
  }

  function renderConfig() {
    configAnchor.classList.add('ld');
    const colorCount = config.colors.length + (config.surprise ? 1 : 0) + (config.freeText ? 1 : 0);
    const seconds = Math.min(config.maxSeconds, Math.max(5, Math.round(3 * config.secondsPer100)));

    const colors = section(
      el('div', { class: 'ld-head' },
        title('pi.twitch.colours', 'Colours'),
        el('span', { class: 'ld-aside', text: colorCount + ' ' + tr('pi.twitch.rewards', 'rewards') })),
      el('p', { class: 'ld-note', text: tr('pi.twitch.coloursHelp', 'Each ticked colour becomes a button in the channel points menu. The viewer clicks, nothing to type.') }),
      el('div', { class: 'ld-tiles three' }, PALETTE.map(([id, english, hex]) => el('button', {
        type: 'button', class: 'ld-tile', 'aria-pressed': String(config.colors.includes(id)), onclick: () => toggleIn('colors', id),
      }, el('span', { class: 'ld-swatch', style: 'background: ' + hex }), el('span', { text: tr('pi.twitch.colour.' + id, english) })))),
      el('button', {
        type: 'button', class: 'ld-tile wide', 'aria-pressed': String(config.surprise), onclick: () => change('surprise', !config.surprise),
      }, el('span', { class: 'ld-name', style: 'flex: 1', text: tr('pi.twitch.surprise', 'Surprise colour') }), el('span', { class: 'ld-aside', text: tr('pi.twitch.surpriseAside', 'at random') })),
      el('button', {
        type: 'button', class: 'ld-tile wide', 'aria-pressed': String(config.freeText), onclick: () => change('freeText', !config.freeText),
      }, el('span', { class: 'ld-name', style: 'flex: 1', text: tr('pi.twitch.freeText', 'Pick the colour') }), el('span', { class: 'ld-aside', text: tr('pi.twitch.freeTextAside', 'the viewer types it') })),
      config.freeText ? el('p', { class: 'ld-note', text: tr('pi.twitch.inputHelp', 'Viewers type a colour name (red, blue, pink...) or a code such as #ff8800. Black and anything unreadable are refunded automatically.') }) : null);

    const scenarios = section(
      el('div', { class: 'ld-head' },
        title('pi.twitch.scenarios', 'Scenarios'),
        el('span', { class: 'ld-aside', text: config.scenarios.length + ' ' + tr('pi.twitch.rewards', 'rewards') })),
      el('div', { class: 'ld-section', style: 'margin: 0; gap: 4px' }, SCENARIOS.map(([id, english]) => el('label', { class: 'ld-row' + (config.scenarios.includes(id) ? ' checked' : '') },
        el('input', { type: 'checkbox', checked: config.scenarios.includes(id), onchange: () => toggleIn('scenarios', id) }),
        el('span', { class: 'ld-name', text: tr('scenario.' + id + '.name', english) }),
        FLASHING.has(id) ? el('span', { class: 'ld-tag', text: tr('pi.twitch.flashes', 'flashes') }) : null))),
      el('div', { class: 'ld-box' },
        el('span', { style: 'font-weight: 600', text: tr('pi.twitch.durationTitle', 'Duration set by the price') }),
        stepper(tr('pi.twitch.rate', 'Seconds per 100 points'), config.secondsPer100, '',
          () => change('secondsPer100', Math.max(1, config.secondsPer100 - 1)),
          () => change('secondsPer100', Math.min(60, config.secondsPer100 + 1))),
        stepper(tr('pi.twitch.cap', 'Longest duration'), config.maxSeconds, ' s',
          () => change('maxSeconds', Math.max(5, config.maxSeconds - 5)),
          () => change('maxSeconds', Math.min(300, config.maxSeconds + 5))),
        el('p', { class: 'ld-note', text: tr('pi.twitch.example', 'Example: a scenario bought for 300 points lasts') + ' ' + seconds + ' s. '
          + tr('pi.twitch.exampleTail', 'Change the price in your Twitch dashboard: the duration follows.') }),
        el('label', { class: 'ld-check' },
          el('input', { type: 'checkbox', checked: config.together, onchange: (e) => change('together', e.target.checked) }),
          el('span', { class: 'ld-name', text: tr('pi.together', 'The bulbs play together') }))));

    configAnchor.replaceChildren(colors, scenarios);
  }

  // --- Historique et deconnexion ---------------------------------------------

  const OUTCOMES = {
    applied: ['pi.twitch.outcome.applied', 'applied', 'ld-ok'],
    refunded: ['pi.twitch.outcome.refunded', 'refunded', ''],
    unsettled: ['pi.twitch.outcome.unsettled', 'applied, settle it on Twitch', 'ld-err'],
    'refund-failed': ['pi.twitch.outcome.refundFailed', 'not applied, refund it on Twitch', 'ld-err'],
  };

  function renderHistory() {
    historyAnchor.classList.add('ld');
    const history = status && Array.isArray(status.history) ? status.history : [];
    if (history.length === 0) { historyAnchor.replaceChildren(); return; }
    historyAnchor.replaceChildren(section(
      title('pi.twitch.last', 'Last redemptions'),
      el('div', { class: 'ld-history' }, history.map((entry) => {
        const [key, english, tone] = OUTCOMES[entry.outcome] || OUTCOMES.refunded;
        return el('div', {},
          el('span', { class: 'ld-what' }, el('strong', { text: entry.user }), el('span', { style: 'opacity: .7', text: ' · ' + entry.what })),
          el('span', { class: 'ld-tag ' + tone, text: tr(key, english) }));
      }))));
  }

  function renderLeave() {
    leaveAnchor.classList.add('ld');
    if (!status || !status.login) { leaveAnchor.replaceChildren(); return; }
    leaveAnchor.replaceChildren(section(
      el('div', { class: 'ld-line' }, el('button', { type: 'button', class: 'ld-danger', style: 'padding: 0', text: tr('pi.twitch.disconnect', 'Disconnect Twitch'), onclick: () => send({ event: 'twitchDisconnect' }) })),
      el('p', { class: 'ld-note', text: tr('pi.twitch.disconnectHelp', 'Deletes the rewards from your channel and removes LumenDeck’s access.') })));
  }

  const renderAll = () => { renderStatus(); renderConfig(); renderHistory(); renderLeave(); };

  client.sendToPropertyInspector.subscribe((event) => {
    const payload = event?.payload;
    if (!payload || payload.event !== 'twitchStatus') return;
    status = payload;
    renderStatus(); renderHistory(); renderLeave();
  });
  ui.onLocale(renderAll);
  renderAll();

  // Etat initial : le plugin repond par un `twitchStatus`.
  send({ event: 'twitchStatus' });
})();
