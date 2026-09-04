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

  const css = `
    .bd-row { display: flex; gap: 6px; align-items: center; margin: 6px 0; }
    .bd-row input { flex: 1; min-width: 0; }
    .bd-found { border-top: 1px solid rgba(255,255,255,.12); padding-top: 8px; margin-top: 8px; }
    .bd-id { font-family: monospace; font-size: 11px; opacity: .75; }
    .bd-note { font-size: 11px; opacity: .7; margin: 6px 0; }
    .bd-ok { color: #7ddf8f; }
    .bd-err { color: #ff8a80; }
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
