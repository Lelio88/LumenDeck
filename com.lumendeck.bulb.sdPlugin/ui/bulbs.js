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
 * Ce que la decouverte NE trouve PAS : la cle locale. Les ampoules Tuya
 * diffusent leur identifiant et leur adresse, jamais leur cle. Elle reste donc a
 * saisir, mais une fois par ampoule au lieu d'une fois par touche.
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
    '<p class="bd-note">La recherche ecoute les annonces que vos ampoules diffusent ' +
    'deja sur le reseau. Elle trouve leur identifiant et leur adresse, mais pas leur ' +
    'cle : celle-ci reste a coller une fois par ampoule.</p>' +
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

  /** Dessine une ampoule trouvee, avec son champ de cle et son bouton. */
  function renderFound(bulb) {
    const row = document.createElement('div');
    row.className = 'bd-found';

    const head = document.createElement('div');
    head.className = 'bd-id';
    head.textContent = bulb.id + '  ·  ' + bulb.ip + '  ·  protocole ' + bulb.version +
      (bulb.known ? '  ·  deja enregistree' : '');
    row.appendChild(head);

    const name = document.createElement('input');
    name.type = 'text';
    name.placeholder = 'Nom (facultatif) — ex. Bureau';

    const key = document.createElement('input');
    key.type = 'password';
    key.placeholder = bulb.known ? 'Cle inchangee si vide' : 'Cle locale';

    const save = document.createElement('button');
    save.type = 'button';
    save.textContent = 'Enregistrer';
    save.addEventListener('click', () => {
      if (!bulb.known && !key.value.trim()) {
        say('Cette ampoule a besoin de sa cle locale pour etre pilotable.', 'err');
        return;
      }
      send({ event: 'saveBulb', id: bulb.id, ip: bulb.ip, key: key.value.trim(), name: name.value.trim() });
    });

    const line1 = document.createElement('div');
    line1.className = 'bd-row';
    line1.append(name);

    const line2 = document.createElement('div');
    line2.className = 'bd-row';
    line2.append(key, save);

    row.append(line1, line2);
    return row;
  }

  scanButton.addEventListener('click', () => {
    results.innerHTML = '';
    scanButton.disabled = true;
    say('Recherche en cours, six secondes...');
    send({ event: 'discoverBulbs' });
  });

  client.sendToPropertyInspector.subscribe((event) => {
    const payload = event?.payload;
    if (!payload || typeof payload.event !== 'string') return;

    if (payload.event === 'discoverBulbs') {
      scanButton.disabled = false;
      const items = Array.isArray(payload.items) ? payload.items : [];
      if (items.length === 0) {
        say('Aucune ampoule reperee. Verifiez qu\'elle est alimentee et sur le meme reseau ' +
            'que cet ordinateur, et que le pare-feu ne bloque pas Stream Deck.', 'err');
        return;
      }
      say(items.length + ' ampoule(s) trouvee(s).', 'ok');
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
