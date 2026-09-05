/**
 * Assistant de declaration des ampoules, partage par les quatre panneaux.
 *
 * Ce que fait ce script : chercher les ampoules sur le reseau, et permettre d'en
 * enregistrer une avec sa cle — UNE SEULE FOIS, dans les reglages globaux du
 * plugin. Les touches n'ont ensuite qu'a en choisir une dans une liste.
 *
 * Choix non evident : l'interface est construite en JavaScript plutot qu'ecrite
 * dans chaque page. Les quatre panneaux partagent exactement le meme bloc ; le
 * dupliquer quatre fois garantissait qu'il diverge a la premiere correction.
 * Chaque page se contente d'un div d'ancrage.
 *
 * DEUX METHODES DE RECHERCHE, et le panneau doit savoir presenter les deux :
 *   - par annonces : l'ampoule dit qui elle est, on connait son identifiant ;
 *   - par balayage : on a frappe a chaque adresse du reseau, donc on connait
 *     l'adresse mais pas l'identifiant — sauf si l'ampoule etait deja enregistree
 *     et que le plugin a su la reconnaitre.
 *
 * Ce que la recherche ne trouve JAMAIS : la cle locale. Elle n'est pas diffusee
 * et ne s'obtient pas depuis le reseau. Elle reste a coller une fois par ampoule.
 */
(() => {
  const client = window.SDPIComponents?.streamDeckClient;
  const anchor = document.getElementById('bulb-manager');
  if (!client || !anchor) return;

  // --- Traduction ---------------------------------------------------------
  // Les panneaux sont ECRITS en anglais ; le dictionnaire ne fait que
  // remplacer. Consequence voulue : si le chargement echoue, l'interface reste
  // lisible en anglais au lieu d'afficher des cles nues.
  //
  // La langue vient de navigator.language, comme le fait sdpi-components :
  // c'est la seule information dont dispose un panneau, qui est une page web.
  // Stream Deck, lui, ne connait pas l'italien — un panneau peut donc etre en
  // italien alors que l'application autour reste en anglais.
  const LANGUES = ['en', 'fr', 'de', 'es', 'it'];
  let dico = {};

  const langue = () => {
    const brut = (navigator.language || 'en').split('-')[0].toLowerCase();
    return LANGUES.includes(brut) ? brut : 'en';
  };

  /** Traduit une cle pointee, ou rend le texte anglais fourni en repli. */
  const tr = (cle, repli) => {
    const valeur = cle.split('.').reduce((n, p) => (n == null ? undefined : n[p]), dico);
    return typeof valeur === 'string' ? valeur : repli;
  };

  /** Remplace les textes portant un attribut de localisation. */
  const localiser = (racine) => {
    racine.querySelectorAll('[data-i18n]').forEach((el) => {
      el.textContent = tr(el.dataset.i18n, el.textContent);
    });
    racine.querySelectorAll('[data-i18n-label]').forEach((el) => {
      el.setAttribute('label', tr(el.dataset.i18nLabel, el.getAttribute('label') || ''));
    });
    racine.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
      el.setAttribute('placeholder', tr(el.dataset.i18nPlaceholder, el.getAttribute('placeholder') || ''));
    });
  };

  // Les couleurs viennent des variables de sdpi-components, jamais de valeurs en
  // dur : le panneau suit ainsi le theme de Stream Deck au lieu de jurer avec.
  // Les champs bruts heritaient sinon des defauts du navigateur — texte sombre
  // sur fond sombre, illisible.
  const css = `
    #bulb-manager {
      font-family: var(--font-family, "Segoe UI", sans-serif);
      font-size: var(--font-size, 12px);
      color: var(--font-color, #d8d8d8);
    }
    #bulb-manager input {
      flex: 1;
      min-width: 0;
      box-sizing: border-box;
      height: var(--input-height, 24px);
      padding: 0 8px;
      background-color: var(--input-bg-color, #3d3d3d);
      color: var(--input-font-color, #d8d8d8);
      border: 1px solid rgba(255, 255, 255, .10);
      border-radius: 4px;
      outline: none;
      font-family: inherit;
      font-size: inherit;
    }
    #bulb-manager input::placeholder { color: var(--font-color, #d8d8d8); opacity: .45; }
    #bulb-manager input:focus { border-color: #ffb247; }

    #bulb-manager button {
      height: var(--input-height, 24px);
      padding: 0 12px;
      background-color: var(--input-bg-color, #3d3d3d);
      color: var(--input-font-color, #d8d8d8);
      border: 1px solid rgba(255, 255, 255, .12);
      border-radius: 4px;
      cursor: pointer;
      font-family: inherit;
      font-size: inherit;
      white-space: nowrap;
    }
    #bulb-manager button:hover:not(:disabled) { border-color: #ffb247; color: #ffb247; }
    #bulb-manager button:disabled { opacity: var(--opacity-disabled, .5); cursor: default; }

    /* Action principale : la seule teintee, pour qu'on sache ou cliquer. */
    #bd-scan { background-color: #ffb247; color: #1a1a1a; border-color: transparent; font-weight: 600; }
    #bd-scan:hover:not(:disabled) { background-color: #ffc474; color: #1a1a1a; }

    .bd-row { display: flex; gap: 6px; align-items: center; margin: 6px 0; }

    /* Chaque appareil trouve est une petite surface, pas une ligne de plus. */
    .bd-found {
      background: rgba(255, 255, 255, .04);
      border: 1px solid rgba(255, 255, 255, .08);
      border-radius: 6px;
      padding: 8px 10px;
      margin-top: 8px;
    }
    .bd-id {
      font-family: ui-monospace, Consolas, monospace;
      font-size: 11px;
      opacity: .7;
      word-break: break-all;
      margin-bottom: 4px;
    }
    .bd-note { font-size: 11px; opacity: .72; margin: 6px 0; line-height: 1.45; }
    .bd-ok { color: #7ddf8f; opacity: 1; }
    .bd-err { color: #ff8a80; opacity: 1; }
  `;

  anchor.innerHTML =
    '<style>' + css + '</style>' +
    '<p class="bd-note" data-i18n="pi.scan.note">The search first listens for the ' +
    'announcements your bulbs broadcast, then, if nothing arrives, knocks at every address ' +
    'on the network. Allow about twenty seconds in the worst case. It finds address and ' +
    'identifier, but never the key: that one still has to be pasted once per bulb.</p>' +
    '<div class="bd-row"><button type="button" id="bd-scan" data-i18n="pi.scan.button">' +
    'Search the network</button></div>' +
    '<div id="bd-status" class="bd-note"></div>' +
    '<div id="bd-results"></div>';

  const scanButton = anchor.querySelector('#bd-scan');
  const status = anchor.querySelector('#bd-status');
  const results = anchor.querySelector('#bd-results');

  const say = (message, kind) => {
    status.textContent = message;
    status.className = 'bd-note' + (kind ? ' bd-' + kind : '');
  };

  const send = (payload) => client.send('sendToPlugin', payload);

  const field = (type, placeholder) => {
    const input = document.createElement('input');
    input.type = type;
    input.placeholder = placeholder;
    return input;
  };

  /** Dessine un appareil trouve, avec ce qu'il reste a renseigner. */
  function renderFound(bulb) {
    const row = document.createElement('div');
    row.className = 'bd-found';

    const head = document.createElement('div');
    head.className = 'bd-id';
    head.textContent = bulb.id
      ? bulb.id + '  ·  ' + bulb.ip
        + (bulb.known ? '  ·  ' + tr('pi.found.already', 'already saved') : '')
      : tr('pi.found.device', 'Tuya device at') + ' ' + bulb.ip
        + '  ·  ' + tr('pi.found.noId', 'unknown identifier');
    row.appendChild(head);

    // Trouve par balayage : l'identifiant n'a pas pu etre lu, il faut le fournir.
    const idInput = bulb.id ? null : field('text', tr('pi.field.id', 'Bulb identifier'));
    const name = field('text', tr('pi.field.name', 'Name (optional) — e.g. Desk'));
    const key = field('password', bulb.known
      ? tr('pi.field.keyKept', 'Leave empty to keep the key')
      : tr('pi.field.key', 'Local key'));

    const save = document.createElement('button');
    save.type = 'button';
    save.textContent = tr('pi.save.button', 'Save');
    save.addEventListener('click', () => {
      const id = bulb.id ?? idInput.value.trim();
      if (!id) {
        say(tr('pi.save.missingId', "This bulb's identifier is missing."), 'err');
        return;
      }
      if (!bulb.known && !key.value.trim()) {
        say(tr('pi.save.needKey', 'This bulb needs its local key to be controllable.'), 'err');
        return;
      }
      // La version du protocole est relevee pendant la recherche et n'est
      // connaissable qu'a ce moment : l'ampoule ne l'annonce que dans sa
      // diffusion. La transmettre ici evite de supposer 3.3 pour toujours.
      send({
        event: 'saveBulb',
        id,
        ip: bulb.ip,
        key: key.value.trim(),
        name: name.value.trim(),
        version: bulb.version || '',
      });
    });

    if (idInput) {
      const line = document.createElement('div');
      line.className = 'bd-row';
      line.append(idInput);
      row.append(line);
    }

    const nameLine = document.createElement('div');
    nameLine.className = 'bd-row';
    nameLine.append(name);

    const keyLine = document.createElement('div');
    keyLine.className = 'bd-row';
    keyLine.append(key, save);

    row.append(nameLine, keyLine);
    return row;
  }

  scanButton.addEventListener('click', () => {
    results.innerHTML = '';
    scanButton.disabled = true;
    say(tr('pi.scan.running', 'Searching...'));
    send({ event: 'discoverBulbs' });
  });

  client.sendToPropertyInspector.subscribe((event) => {
    const payload = event?.payload;
    if (!payload || typeof payload.event !== 'string') return;

    if (payload.event === 'discoverBulbs') {
      scanButton.disabled = false;
      const items = Array.isArray(payload.items) ? payload.items : [];

      if (items.length === 0) {
        say(tr('pi.scan.none', 'No device found. Check that the bulb is powered and on the '
          + 'same network as this computer.'), 'err');
        return;
      }

      const how = payload.method === 'balayage'
        ? tr('pi.scan.sweep', ' (found by sweeping the network: your bulbs do not broadcast '
            + 'this far, which is common between a wired computer and a Wi-Fi bulb)')
        : '';
      say(items.length + ' ' + tr('pi.scan.found', 'device(s) found') + how, 'ok');
      items.forEach((bulb) => results.appendChild(renderFound(bulb)));
      return;
    }

    // Une seule ampoule au registre : la liste deroulante n'a qu'une reponse
    // possible, on la choisit d'office plutot que d'exiger un clic sans
    // alternative. Le plugin applique deja ce repli de son cote ; ceci sert a ce
    // que la liste MONTRE l'ampoule retenue, au lieu de paraitre vide alors que
    // la touche fonctionne.
    if (payload.event === 'getBulbs') {
      const items = Array.isArray(payload.items) ? payload.items : [];
      if (items.length !== 1) return;
      // Le composant se peuple juste apres ce message : on laisse passer un tour
      // de boucle avant de lire sa valeur, sinon on ecraserait un choix existant
      // par une lecture prematuree.
      setTimeout(() => {
        try {
          const select = document.querySelector('sdpi-select[setting="deviceId"]');
          if (select && !select.value) select.value = items[0].value;
        } catch { /* le repli cote plugin suffit : ne jamais casser le panneau */ }
      }, 0);
      return;
    }

    if (payload.event === 'saveBulb') {
      if (payload.ok) {
        say(tr('pi.save.ok', 'Bulb saved. Choose it in the list above.'), 'ok');
        results.innerHTML = '';
      } else {
        say(payload.message || tr('pi.save.failed', 'Could not save.'), 'err');
      }
    }
  });

  // Charge le dictionnaire APRES la construction de l'interface : la
  // substitution est imperceptible, et l'affichage ne depend jamais de ce
  // chargement pour aboutir.
  fetch('../' + langue() + '.json')
    .then((r) => (r.ok ? r.json() : null))
    .then((json) => {
      dico = (json && json.Localization) || {};
      localiser(document);
    })
    .catch(() => { /* pas de dictionnaire : l'anglais du HTML fait foi */ });
})();
