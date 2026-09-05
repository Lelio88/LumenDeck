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
    '<p class="bd-note">La recherche ecoute d\'abord les annonces que vos ampoules ' +
    'diffusent, puis, si rien n\'arrive, frappe a chaque adresse du reseau. Comptez ' +
    'une vingtaine de secondes dans le pire cas. Elle trouve adresse et identifiant, ' +
    'mais jamais la cle : celle-ci reste a coller une fois par ampoule.</p>' +
    '<div class="bd-row"><button type="button" id="bd-scan">Rechercher mes ampoules</button></div>' +
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
      ? bulb.id + '  ·  ' + bulb.ip + (bulb.known ? '  ·  deja enregistree' : '')
      : 'Appareil Tuya a ' + bulb.ip + '  ·  identifiant inconnu';
    row.appendChild(head);

    // Trouve par balayage : l'identifiant n'a pas pu etre lu, il faut le fournir.
    const idInput = bulb.id ? null : field('text', 'Identifiant de l\'ampoule');
    const name = field('text', 'Nom (facultatif) — ex. Bureau');
    const key = field('password', bulb.known ? 'Cle inchangee si vide' : 'Cle locale');

    const save = document.createElement('button');
    save.type = 'button';
    save.textContent = 'Enregistrer';
    save.addEventListener('click', () => {
      const id = bulb.id ?? idInput.value.trim();
      if (!id) {
        say('Il manque l\'identifiant de cette ampoule.', 'err');
        return;
      }
      if (!bulb.known && !key.value.trim()) {
        say('Cette ampoule a besoin de sa cle locale pour etre pilotable.', 'err');
        return;
      }
      send({ event: 'saveBulb', id, ip: bulb.ip, key: key.value.trim(), name: name.value.trim() });
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
    say('Recherche en cours...');
    send({ event: 'discoverBulbs' });
  });

  client.sendToPropertyInspector.subscribe((event) => {
    const payload = event?.payload;
    if (!payload || typeof payload.event !== 'string') return;

    if (payload.event === 'discoverBulbs') {
      scanButton.disabled = false;
      const items = Array.isArray(payload.items) ? payload.items : [];

      if (items.length === 0) {
        say('Aucun appareil trouve. Verifiez que l\'ampoule est alimentee et sur le meme ' +
            'reseau que cet ordinateur.', 'err');
        return;
      }

      const how = payload.method === 'balayage'
        ? ' (trouve par balayage du reseau : vos ampoules ne diffusent pas jusqu\'ici, ' +
          'c\'est frequent entre un ordinateur filaire et une ampoule en wifi)'
        : '';
      say(items.length + ' appareil(s) trouve(s)' + how, 'ok');
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
        say('Ampoule enregistree. Choisissez-la dans la liste ci-dessus.', 'ok');
        results.innerHTML = '';
      } else {
        say(payload.message || 'Echec de l\'enregistrement.', 'err');
      }
    }
  });
})();
