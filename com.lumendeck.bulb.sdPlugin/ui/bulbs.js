/**
 * Socle commun des panneaux : traduction, choix des ampoules d'une touche, et
 * gestion des ampoules connues (ajout, renommage, cle, oubli).
 *
 * Ce que fait ce script :
 *   - traduire la page (attributs `data-i18n*`) et offrir `tr()` aux autres
 *     scripts du panneau, via `window.LumenDeckUI` ;
 *   - dessiner, dans `#bulb-picker`, la liste des ampoules a cocher pour la
 *     touche, avec une pastille en ligne / hors ligne. Avec `data-ordered`,
 *     l'ordre se regle par fleches : c'est le sens dans lequel la lumiere se
 *     deplace dans un scenario ;
 *   - dessiner, dans `#bulb-manager`, « Mes ampoules » (une carte par ampoule,
 *     les champs caches derriere « Modifier ») et « Ajouter des ampoules »
 *     (QR code de l'appli Calex, ou recherche sur le reseau).
 *
 * Choix non evidents :
 *
 *   - La liste a cocher n'est plus `sdpi-checkbox-list` : ce composant range les
 *     ampoules dans SON ordre et ne sait pas montrer d'etat. On ecrit le reglage
 *     `deviceIds` par `SDPIComponents.useSettings`, qui partage le meme stockage
 *     que les composants sdpi de la page : ecrire les reglages autrement les
 *     ferait s'ecraser mutuellement avec une copie perimee.
 *
 *   - Aucune donnee n'est inseree en HTML : noms et adresses viennent de
 *     l'utilisateur ou du reseau, ils passent par `textContent`. Seul le
 *     squelette statique est ecrit d'un bloc.
 *
 *   - Une ampoule deja enregistree n'affiche AUCUN champ tant qu'on ne clique
 *     pas sur « Modifier » : un formulaire visible laisse croire qu'il reste
 *     quelque chose a faire. La recherche resume les ampoules connues en une
 *     ligne et ne montre un formulaire que pour un appareil nouveau.
 *
 *   - Les textes sont ECRITS en anglais dans ce script ; le dictionnaire ne fait
 *     que remplacer. Si son chargement echoue, le panneau reste lisible.
 *
 *   - La cle locale ne repart jamais vers le panneau : le plugin ne renvoie que
 *     nom, identifiant, adresse et un booleen « a une cle ».
 */
(() => {
  const sdpi = window.SDPIComponents;
  const client = sdpi?.streamDeckClient;
  if (!client) return;

  // --- Traduction -----------------------------------------------------------
  // La langue vient de navigator.language, comme le fait sdpi-components : c'est
  // la seule information dont dispose un panneau, qui est une page web.
  const LANGUES = ['en', 'fr', 'de', 'es', 'it', 'ja', 'ko'];
  let dico = {};
  const localeListeners = [];

  const langue = () => {
    const brut = (navigator.language || 'en').toLowerCase();
    // Le chinois ne se deduit pas d'un prefixe : Stream Deck distingue les deux
    // ecritures (zh_CN, zh_TW), la ou le navigateur annonce tantot la region,
    // tantot le systeme d'ecriture. « zh » seul vaut simplifie.
    if (brut.startsWith('zh')) return /hant|tw|hk|mo/.test(brut) ? 'zh_TW' : 'zh_CN';
    const court = brut.split('-')[0];
    return LANGUES.includes(court) ? court : 'en';
  };

  /** Traduit une cle pointee, ou rend le texte anglais fourni en repli. */
  const tr = (cle, repli) => {
    const valeur = cle.split('.').reduce((n, p) => (n == null ? undefined : n[p]), dico);
    return typeof valeur === 'string' ? valeur : repli;
  };

  /**
   * Remplace les textes portant un attribut de localisation.
   *
   * Les composants sdpi sont des elements Lit : poser l'ATTRIBUT ne suffit pas a
   * les redessiner s'ils ont deja lu leur valeur. On ecrit donc aussi la
   * PROPRIETE, et on demande un rendu.
   */
  const poser = (el, nom, valeur) => {
    el.setAttribute(nom, valeur);
    try { el[nom] = valeur; } catch { /* element pas encore promu : l'attribut suffira */ }
    try { el.requestUpdate?.(); } catch { /* pas un element Lit */ }
  };

  const localiser = (racine) => {
    racine.querySelectorAll('[data-i18n]').forEach((el) => {
      el.textContent = tr(el.dataset.i18n, el.textContent);
    });
    racine.querySelectorAll('[data-i18n-label]').forEach((el) => {
      poser(el, 'label', tr(el.dataset.i18nLabel, el.getAttribute('label') || ''));
    });
    racine.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
      poser(el, 'placeholder', tr(el.dataset.i18nPlaceholder, el.getAttribute('placeholder') || ''));
    });
  };

  const send = (payload) => client.send('sendToPlugin', payload);

  // --- Petits outils de dessin ---------------------------------------------

  /** Cree un element avec ses attributs et ses enfants. Le texte passe par textContent. */
  const el = (tag, attrs = {}, ...children) => {
    const node = document.createElement(tag);
    for (const [name, value] of Object.entries(attrs)) {
      if (value === undefined || value === null || value === false) continue;
      if (name === 'class') node.className = value;
      else if (name === 'text') node.textContent = value;
      else if (name.startsWith('on')) node.addEventListener(name.slice(2), value);
      else node.setAttribute(name, value === true ? '' : String(value));
    }
    for (const child of children.flat()) if (child) node.append(child);
    return node;
  };

  /** Icone de fleche (haut ou bas), decorative. */
  const chevron = (up) => {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('width', '14'); svg.setAttribute('height', '14'); svg.setAttribute('viewBox', '0 0 14 14');
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS(ns, 'path');
    path.setAttribute('d', up ? 'M3 9l4-4 4 4' : 'M3 5l4 4 4-4');
    path.setAttribute('fill', 'none'); path.setAttribute('stroke', 'currentColor');
    path.setAttribute('stroke-width', '1.8'); path.setAttribute('stroke-linecap', 'round'); path.setAttribute('stroke-linejoin', 'round');
    svg.append(path);
    return svg;
  };

  // Les couleurs viennent des variables de sdpi-components quand elles existent :
  // le panneau suit le theme de Stream Deck au lieu de jurer avec. L'ambre est
  // la seule couleur d'accent, comme sur les touches.
  const css = `
    .ld { font-family: var(--font-family, "Segoe UI", sans-serif); font-size: var(--font-size, 12px);
          color: var(--font-color, #d8d8d8); }
    .ld-section { display: flex; flex-direction: column; gap: 8px; margin: 14px 0; }
    .ld-head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
    .ld-title { margin: 0; font-size: 11px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; opacity: .7; }
    .ld-aside { font-size: 11px; opacity: .65; }
    .ld-note { margin: 0; font-size: 11px; line-height: 1.5; opacity: .72; }
    .ld-ok { color: #6fd38a; opacity: 1; }
    .ld-err { color: #ff9b91; opacity: 1; }
    .ld-mono { font-family: ui-monospace, Consolas, monospace; }
    .ld-dot { width: 8px; height: 8px; border-radius: 50%; flex: none; background: #6b6d74; }
    .ld-dot.on { background: #6fd38a; } .ld-dot.off { background: #ff8a80; }
    .ld-row { display: flex; align-items: center; gap: 10px; min-height: 36px; padding: 0 8px 0 10px; border-radius: 8px;
              background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.08); cursor: pointer; }
    .ld-row.checked { background: rgba(255,178,71,.10); border-color: rgba(255,178,71,.45); }
    .ld-row input[type=checkbox] { width: 15px; height: 15px; margin: 0; accent-color: #ffb247; }
    .ld-row .ld-name { flex: 1; min-width: 0; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .ld-rank { width: 20px; height: 20px; border-radius: 50%; display: flex; align-items: center; justify-content: center;
               background: rgba(255,255,255,.10); font-size: 11px; flex: none; }
    .ld-card { background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.08); border-radius: 10px; overflow: hidden; }
    .ld-card.new { border-color: rgba(255,178,71,.6); }
    .ld-card-head { display: flex; align-items: center; gap: 10px; padding: 10px 10px 10px 12px; }
    .ld-card-text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
    .ld-card-name { font-size: 13px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .ld-card-sub { font-size: 11px; opacity: .72; }
    .ld-card-body { border-top: 1px solid rgba(255,255,255,.08); padding: 12px; display: flex; flex-direction: column; gap: 10px;
                    background: rgba(0,0,0,.12); }
    .ld-field { display: flex; flex-direction: column; gap: 4px; }
    .ld-field label { font-size: 11px; opacity: .72; }
    .ld input[type=text], .ld input[type=password] {
      height: 28px; padding: 0 8px; box-sizing: border-box; min-width: 0; border-radius: 5px; outline: none;
      background: var(--input-bg-color, #3d3d3d); color: var(--input-font-color, #d8d8d8);
      border: 1px solid rgba(255,255,255,.10); font-family: inherit; font-size: inherit; }
    .ld input:focus { border-color: #ffb247; }
    .ld input::placeholder { color: var(--font-color, #d8d8d8); opacity: .45; }
    .ld-line { display: flex; gap: 6px; align-items: center; }
    .ld-line > input { flex: 1; }
    .ld-spread { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    .ld button { height: 28px; padding: 0 12px; border-radius: 5px; cursor: pointer; white-space: nowrap;
                 background: var(--input-bg-color, #3d3d3d); color: var(--input-font-color, #d8d8d8);
                 border: 1px solid rgba(255,255,255,.12); font-family: inherit; font-size: inherit; }
    .ld button:hover:not(:disabled) { border-color: #ffb247; color: #ffb247; }
    .ld button:disabled { opacity: .5; cursor: default; }
    .ld button.ld-primary { background: #ffb247; color: #1a1a1a; border-color: transparent; font-weight: 600; }
    .ld button.ld-primary:hover:not(:disabled) { background: #ffc474; color: #1a1a1a; }
    .ld button.ld-ghost { background: transparent; }
    .ld button.ld-danger { background: transparent; border-color: transparent; color: #ff9b91; padding: 0 2px; }
    .ld button.ld-icon { width: 28px; padding: 0; display: flex; align-items: center; justify-content: center;
                         background: transparent; border-color: transparent; }
    .ld-tabs { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 3px; padding: 3px; border-radius: 7px;
               background: rgba(0,0,0,.25); }
    .ld-tabs button { border: none; background: transparent; opacity: .7; }
    .ld-tabs button[aria-selected=true] { background: rgba(255,255,255,.10); opacity: 1; font-weight: 600; }
    .ld-qr img { display: block; margin: 6px auto; background: #fff; padding: 8px; border-radius: 6px; }
    .ld-tiles { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 5px; }
    .ld-tiles.three { grid-template-columns: repeat(3, minmax(0, 1fr)); }
    .ld button.ld-tile { height: 34px; display: flex; align-items: center; justify-content: flex-start; gap: 8px; text-align: left;
                         background: rgba(255,255,255,.04); border-color: rgba(255,255,255,.08); opacity: .8;
                         overflow: hidden; text-overflow: ellipsis; }
    .ld button.ld-tile[aria-pressed=true] { background: rgba(255,178,71,.12); border-color: #ffb247; color: inherit; opacity: 1; font-weight: 600; }
    .ld button.ld-tile.wide { width: 100%; }
    .ld-swatch { width: 14px; height: 14px; border-radius: 50%; flex: none; border: 1px solid rgba(255,255,255,.3); }
    .ld-check { display: flex; align-items: center; gap: 10px; min-height: 32px; cursor: pointer; }
    .ld-check input { width: 15px; height: 15px; margin: 0; accent-color: #ffb247; }
    .ld-check .ld-name { flex: 1; }
    .ld-box { background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.08); border-radius: 10px; padding: 12px;
              display: flex; flex-direction: column; gap: 10px; }
    .ld-tag { font-size: 10px; padding: 1px 7px; border-radius: 999px; border: 1px solid rgba(255,178,71,.5); color: #ffc474; white-space: nowrap; }
    .ld-tag.ld-ok { color: #6fd38a; border-color: rgba(111,211,138,.5); }
    .ld-tag.ld-err { color: #ff9b91; border-color: rgba(255,155,145,.5); }
    .ld-stepper { display: flex; align-items: center; gap: 4px; }
    .ld-stepper output { width: 44px; text-align: center; }
    .ld .ld-stepper button.ld-icon { border-color: rgba(255,255,255,.15); }
    details { font-family: var(--font-family, "Segoe UI", sans-serif); font-size: var(--font-size, 12px);
              color: var(--font-color, #d8d8d8); margin: 14px 0; }
    details summary { cursor: pointer; opacity: .8; }
    details p { font-size: 11px; line-height: 1.5; opacity: .8; }
    .ld-code { font-family: ui-monospace, Consolas, monospace; font-size: 22px; font-weight: 600; letter-spacing: .18em;
               text-align: center; padding: 10px; border-radius: 8px; background: rgba(255,255,255,.05); }
    .ld-history { display: flex; flex-direction: column; border: 1px solid rgba(255,255,255,.08); border-radius: 10px; overflow: hidden; }
    .ld-history > div { display: flex; align-items: center; gap: 8px; padding: 8px 10px; background: rgba(255,255,255,.03); }
    .ld-history > div + div { border-top: 1px solid rgba(255,255,255,.06); }
    .ld-history .ld-what { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  `;
  document.head.append(el('style', { text: css }));

  // --- Donnees partagees ----------------------------------------------------

  /** Ampoules connues : { id, name, ip, hasKey }. */
  let bulbs = [];
  let bulbsLoaded = false;
  /** id -> true (en ligne), false (hors ligne) ; absent : verification en cours. */
  let online = {};
  const redrawers = [];
  const redraw = () => redrawers.forEach((fn) => fn());

  const statusText = (id) => (online[id] === true ? tr('pi.status.online', 'Online')
    : online[id] === false ? tr('pi.status.offline', 'Offline') : tr('pi.status.checking', 'Checking…'));
  const dot = (id) => el('span', { class: 'ld-dot' + (online[id] === true ? ' on' : online[id] === false ? ' off' : '') });

  // --- Ampoules de la touche ------------------------------------------------

  function mountPicker(anchor) {
    anchor.classList.add('ld');
    const ordered = anchor.dataset.ordered === 'true';
    let selected = [];
    let loaded = false;

    const clean = (value) => (Array.isArray(value) ? [...new Set(value.filter((v) => typeof v === 'string' && v))] : []);
    // Ecriture immediate (delai 0) : un clic suivi de la fermeture du panneau ne
    // doit pas perdre le choix, ni un echo du plugin le ramener en arriere.
    const [getIds, setIds] = sdpi.useSettings('deviceIds', (value) => { selected = clean(value); render(); }, 0);

    // Une ampoule oubliee peut rester dans les reglages de la touche : on l'ecarte
    // avant toute modification, sinon elle fausserait les rangs et les fleches.
    const visible = () => selected.filter((id) => bulbs.some((b) => b.id === id));
    const save = () => { setIds([...selected]); render(); };
    const toggle = (id) => {
      const current = visible();
      selected = current.includes(id) ? current.filter((x) => x !== id) : [...current, id];
      save();
    };
    const move = (id, delta) => {
      const next = visible();
      const i = next.indexOf(id);
      const j = i + delta;
      if (i < 0 || j < 0 || j >= next.length) return;
      [next[i], next[j]] = [next[j], next[i]];
      selected = next;
      save();
    };

    // Une seule ampoule declaree : la liste n'a qu'une reponse possible, on la
    // coche d'office. Le plugin applique deja ce repli ; ceci sert a ce que la
    // liste MONTRE l'ampoule retenue.
    const autoSelect = () => {
      if (!loaded || !bulbsLoaded || bulbs.length !== 1 || selected.length > 0) return;
      selected = [bulbs[0].id];
      save();
    };

    function render() {
      const shown = visible();
      const rows = ordered
        ? [...shown, ...bulbs.map((b) => b.id).filter((id) => !shown.includes(id))]
        : bulbs.map((b) => b.id);

      const head = el('div', { class: 'ld-head' },
        el('h2', { class: 'ld-title', text: tr('pi.bulbs', 'Bulbs') }),
        ordered ? el('span', { class: 'ld-aside', text: tr('pi.picker.orderHint', 'Light travels from 1 onwards') }) : null);

      const list = bulbs.length === 0
        ? el('p', { class: 'ld-note', text: tr('pi.picker.empty', 'No bulb yet: add one below.') })
        : el('div', { class: 'ld-section', style: 'margin: 0; gap: 5px' }, rows.map((id) => {
          const bulb = bulbs.find((b) => b.id === id);
          const checked = shown.includes(id);
          const rank = shown.indexOf(id) + 1;
          return el('label', { class: 'ld-row' + (checked ? ' checked' : '') },
            el('input', { type: 'checkbox', checked, onchange: () => toggle(id) }),
            ordered && checked ? el('span', { class: 'ld-rank ld-mono', text: String(rank) }) : null,
            dot(id),
            el('span', { class: 'ld-name', text: bulb.name }),
            el('span', { class: 'ld-aside', text: statusText(id) }),
            ordered && checked ? el('button', {
              type: 'button', class: 'ld-icon', 'aria-label': tr('pi.picker.up', 'Move up'),
              onclick: (e) => { e.preventDefault(); move(id, -1); },
            }, chevron(true)) : null,
            ordered && checked ? el('button', {
              type: 'button', class: 'ld-icon', 'aria-label': tr('pi.picker.down', 'Move down'),
              onclick: (e) => { e.preventDefault(); move(id, 1); },
            }, chevron(false)) : null);
        }));

      anchor.replaceChildren(el('div', { class: 'ld-section', style: 'margin-top: 0' }, head, list));
    }

    getIds().then((value) => { selected = clean(value); loaded = true; autoSelect(); render(); }, () => { loaded = true; render(); });
    redrawers.push(() => { autoSelect(); render(); });
    render();
  }

  // --- Mes ampoules, et ajout -----------------------------------------------

  function mountManager(anchor) {
    anchor.classList.add('ld');
    const mine = el('div');
    const adder = el('div');
    anchor.replaceChildren(mine, adder);

    let openId = null;
    let confirmForget = false;
    let mode = 'qr';
    const scan = { running: false, items: null, method: null, message: null, tone: null };
    const cloud = { polling: null, message: '', tone: null, qr: null, busy: false, code: '' };

    // -- Mes ampoules --
    function renderMine() {
      const cards = bulbs.map((bulb) => {
        const open = openId === bulb.id;
        const head = el('div', { class: 'ld-card-head' },
          dot(bulb.id),
          el('div', { class: 'ld-card-text' },
            el('span', { class: 'ld-card-name', text: bulb.name }),
            el('span', { class: 'ld-card-sub' },
              el('span', { text: bulb.hasKey ? statusText(bulb.id) : tr('pi.mine.noKey', 'Key missing') }),
              bulb.ip ? el('span', { text: ' · ' }) : null,
              bulb.ip ? el('span', { class: 'ld-mono', text: bulb.ip }) : null)),
          el('button', {
            type: 'button', class: 'ld-ghost',
            text: open ? tr('pi.mine.close', 'Close') : tr('pi.mine.edit', 'Edit'),
            onclick: () => { openId = open ? null : bulb.id; confirmForget = false; renderMine(); },
          }));
        if (!open) return el('article', { class: 'ld-card' }, head);

        const name = el('input', { type: 'text', id: 'ld-name-' + bulb.id, value: bulb.name });
        const key = el('input', { type: 'password', id: 'ld-key-' + bulb.id, placeholder: tr('pi.field.keyKept', 'Leave empty to keep the key') });
        const body = el('div', { class: 'ld-card-body' },
          el('div', { class: 'ld-field' }, el('label', { for: name.id, text: tr('pi.mine.name', 'Name') }), name),
          el('div', { class: 'ld-field' }, el('label', { for: key.id, text: tr('pi.field.key', 'Local key') }), key),
          el('div', { class: 'ld-spread' },
            el('button', {
              type: 'button', class: 'ld-danger',
              text: confirmForget ? tr('pi.mine.forgetConfirm', 'Click again to forget it') : tr('pi.mine.forget', 'Forget this bulb'),
              onclick: () => {
                if (!confirmForget) { confirmForget = true; renderMine(); return; }
                send({ event: 'forgetBulb', id: bulb.id });
                openId = null; confirmForget = false;
              },
            }),
            el('button', {
              type: 'button', class: 'ld-primary', text: tr('pi.save.button', 'Save'),
              onclick: () => {
                send({ event: 'saveBulb', id: bulb.id, name: name.value.trim(), key: key.value.trim() });
                openId = null;
              },
            })));
        return el('article', { class: 'ld-card' }, head, body);
      });

      mine.replaceChildren(el('section', { class: 'ld-section' },
        el('h2', { class: 'ld-title', text: tr('pi.mine.title', 'My bulbs') }),
        bulbs.length === 0 ? el('p', { class: 'ld-note', text: tr('pi.picker.empty', 'No bulb yet: add one below.') }) : null,
        cards));
    }

    // -- Ajouter --
    const say = (message, tone) => el('p', { class: 'ld-note' + (tone ? ' ld-' + tone : ''), text: message });

    function stopPolling() {
      if (cloud.polling) { clearInterval(cloud.polling); cloud.polling = null; }
      cloud.busy = false;
    }

    function renderQr() {
      const code = el('input', { type: 'text', id: 'ld-usercode', value: cloud.code, placeholder: tr('pi.cloud.userCode', 'User code') });
      code.addEventListener('input', () => { cloud.code = code.value; });
      const button = el('button', {
        type: 'button', class: 'ld-primary', disabled: cloud.busy, text: tr('pi.cloud.button', 'Show the QR code'),
        onclick: () => {
          const value = code.value.trim();
          if (!value) { code.focus(); return; }
          stopPolling();
          cloud.busy = true; cloud.qr = null; cloud.message = tr('pi.scan.running', 'Searching...'); cloud.tone = null;
          send({ event: 'tuyaLoginStart', userCode: value });
          renderAdder();
        },
      });
      return [
        el('p', { class: 'ld-note', text: tr('pi.cloud.intro', 'Scan a QR code with the Calex or Smart Life app and every bulb on your account is added, keys included. Nothing to copy by hand.') }),
        el('div', { class: 'ld-field' },
          el('label', { for: code.id, text: tr('pi.cloud.userCode', 'User code') }),
          el('div', { class: 'ld-line' }, code, button)),
        el('p', { class: 'ld-note', text: tr('pi.cloud.where', 'In the app: Me → Settings → Account and security → User code') }),
        cloud.qr ? el('div', { class: 'ld-qr' }, el('img', { src: cloud.qr, alt: '' })) : null,
        cloud.message ? say(cloud.message, cloud.tone) : null,
      ];
    }

    /** Un appareil nouveau, trouve sur le reseau : le seul cas ou il faut un formulaire. */
    function newDevice(item) {
      const idInput = item.id ? null : el('input', { type: 'text', id: 'ld-new-id-' + item.ip, placeholder: tr('pi.field.id', 'Bulb identifier') });
      const name = el('input', { type: 'text', id: 'ld-new-name-' + item.ip, placeholder: tr('pi.scan.namePlaceholder', 'e.g. Hallway') });
      const key = el('input', { type: 'password', id: 'ld-new-key-' + item.ip, placeholder: tr('pi.field.key', 'Local key') });
      const add = el('button', {
        type: 'button', class: 'ld-primary', text: tr('pi.scan.add', 'Add'),
        onclick: () => {
          const id = item.id ?? idInput.value.trim();
          if (!id) { scan.message = tr('pi.save.missingId', "This bulb's identifier is missing."); scan.tone = 'err'; renderAdder(); return; }
          if (!key.value.trim()) { scan.message = tr('pi.save.needKey', 'This bulb needs its local key to be controllable.'); scan.tone = 'err'; renderAdder(); return; }
          // La version du protocole n'est connaissable qu'a la recherche : l'ampoule
          // ne l'annonce que dans sa diffusion. La transmettre evite de supposer 3.3.
          send({ event: 'saveBulb', id, ip: item.ip, key: key.value.trim(), name: name.value.trim(), version: item.version || '' });
        },
      });
      return el('article', { class: 'ld-card new' },
        el('div', { class: 'ld-card-head' },
          el('div', { class: 'ld-card-text' },
            el('span', { class: 'ld-card-name', text: tr('pi.scan.newDevice', 'New device') }),
            el('span', { class: 'ld-card-sub ld-mono', text: item.ip }))),
        el('div', { class: 'ld-card-body' },
          idInput ? el('div', { class: 'ld-field' }, el('label', { for: idInput.id, text: tr('pi.field.id', 'Bulb identifier') }), idInput) : null,
          el('div', { class: 'ld-field' }, el('label', { for: name.id, text: tr('pi.mine.name', 'Name') }), name),
          el('div', { class: 'ld-field' }, el('label', { for: key.id, text: tr('pi.field.key', 'Local key') }), el('div', { class: 'ld-line' }, key, add))));
    }

    function renderScan() {
      const parts = [
        el('p', { class: 'ld-note', text: tr('pi.scan.intro', 'Finds your bulbs and refreshes their address. A new bulb still needs its local key, pasted once.') }),
        el('button', {
          type: 'button', class: 'ld-primary', disabled: scan.running, text: scan.running ? tr('pi.scan.running', 'Searching...') : tr('pi.scan.button', 'Search the network'),
          onclick: () => { scan.running = true; scan.items = null; scan.message = null; send({ event: 'discoverBulbs' }); renderAdder(); },
        }),
      ];
      if (scan.items) {
        const known = scan.items.filter((i) => i.known);
        const fresh = scan.items.filter((i) => !i.known);
        if (scan.items.length === 0) parts.push(say(tr('pi.scan.none', 'No device found. Check that the bulb is powered and on the same network as this computer.'), 'err'));
        if (known.length > 0) {
          const names = known.map((i) => i.name || (i.id || '').slice(-6)).join(', ');
          parts.push(say(tr('pi.scan.upToDate', 'Up to date:') + ' ' + names, 'ok'));
        }
        if (scan.method === 'balayage' && scan.items.length > 0) parts.push(say(tr('pi.scan.sweepShort', 'Found by sweeping the network: your bulbs do not broadcast this far.')));
        fresh.forEach((item) => parts.push(newDevice(item)));
      }
      if (scan.message) parts.push(say(scan.message, scan.tone));
      return parts;
    }

    function renderAdder() {
      const tab = (value, label) => el('button', {
        type: 'button', role: 'tab', 'aria-selected': String(mode === value), text: label,
        onclick: () => { mode = value; renderAdder(); },
      });
      adder.replaceChildren(el('section', { class: 'ld-section' },
        el('h2', { class: 'ld-title', text: tr('pi.add.title', 'Add bulbs') }),
        el('div', { class: 'ld-tabs', role: 'tablist', 'aria-label': tr('pi.add.title', 'Add bulbs') },
          tab('qr', tr('pi.add.qrTab', 'Calex app (QR)')),
          tab('scan', tr('pi.add.scanTab', 'On the network'))),
        mode === 'qr' ? renderQr() : renderScan()));
    }

    // Pendant qu'une carte est ouverte, on ne la redessine pas : on effacerait ce
    // que l'utilisateur est en train de taper.
    // L'ajout ne se redessine qu'au changement de langue : un etat d'ampoule qui
    // arrive ne doit pas vider le formulaire d'un appareil nouveau.
    redrawers.push(() => { if (openId === null) renderMine(); });
    localeListeners.push(renderAdder);
    renderMine();
    renderAdder();

    // Reponses du plugin propres au gestionnaire.
    return (payload) => {
      switch (payload.event) {
        case 'discoverBulbs':
          scan.running = false;
          scan.items = Array.isArray(payload.items) ? payload.items : [];
          scan.method = payload.method;
          renderAdder();
          send({ event: 'getBulbStatus' });
          break;
        case 'saveBulb':
          if (payload.ok) {
            scan.items = scan.items ? scan.items.filter((i) => i.id !== payload.id) : null;
            scan.message = tr('pi.save.ok', 'Bulb saved. Choose it in the list above.'); scan.tone = 'ok';
          } else {
            scan.message = payload.message || tr('pi.save.failed', 'Could not save.'); scan.tone = 'err';
          }
          renderAdder();
          send({ event: 'getBulbStatus' });
          break;
        case 'tuyaLoginStart':
          if (!payload.ok) { stopPolling(); cloud.message = payload.message || ''; cloud.tone = 'err'; renderAdder(); break; }
          cloud.qr = payload.qr;
          cloud.message = tr('pi.cloud.scan', 'Scan this in the app: + (top right) -> Scan.'); cloud.tone = null;
          renderAdder();
          {
            // Le jeton expire vers deux minutes et demie : on interroge toutes les
            // deux secondes et on renonce a deux minutes, pour dire clairement que
            // c'est perime plutot que de laisser tourner une attente muette.
            const debut = Date.now();
            cloud.polling = setInterval(() => {
              if (Date.now() - debut > 120000) {
                stopPolling(); cloud.qr = null;
                cloud.message = tr('pi.cloud.expired', 'The QR code expired. Try again.'); cloud.tone = 'err';
                renderAdder();
                return;
              }
              send({ event: 'tuyaLoginPoll', token: payload.token, userCode: cloud.code.trim() });
            }, 2000);
          }
          break;
        case 'tuyaLoginPoll': {
          if (!payload.ok) { stopPolling(); cloud.message = payload.message || ''; cloud.tone = 'err'; renderAdder(); break; }
          if (!payload.done) {
            const waiting = tr('pi.cloud.waiting', 'Waiting for the scan...');
            if (cloud.message !== waiting) { cloud.message = waiting; cloud.tone = null; renderAdder(); }
            break;
          }
          stopPolling(); cloud.qr = null;
          const noms = Array.isArray(payload.names) ? payload.names : [];
          let message = noms.length + ' ' + tr('pi.cloud.added', 'bulb(s) added');
          if (noms.length) message += ' : ' + noms.join(', ');
          if (payload.ignored > 0) message += '  ' + payload.ignored + ' ' + tr('pi.cloud.ignored', 'other device(s) ignored.');
          cloud.message = message; cloud.tone = noms.length ? 'ok' : 'err';
          renderAdder();
          // L'adresse des nouvelles ampoules est retrouvee en arriere-plan : on
          // redemande leur etat un peu plus tard.
          setTimeout(() => send({ event: 'getBulbStatus' }), 8000);
          break;
        }
        default:
          return;
      }
    };
  }

  // --- Montage et messages --------------------------------------------------

  const pickerAnchor = document.getElementById('bulb-picker');
  if (pickerAnchor) mountPicker(pickerAnchor);
  const managerAnchor = document.getElementById('bulb-manager');
  const managerHandles = managerAnchor ? mountManager(managerAnchor) : null;

  client.sendToPropertyInspector.subscribe((event) => {
    const payload = event?.payload;
    if (!payload || typeof payload.event !== 'string') return;

    if (payload.event === 'getBulbs') {
      const items = Array.isArray(payload.items) ? payload.items : [];
      bulbs = items.map((i) => ({ id: i.value, name: i.label, ip: i.ip || null, hasKey: i.hasKey !== false }));
      bulbsLoaded = true;
      redraw();
      return;
    }
    if (payload.event === 'getBulbStatus') {
      online = {};
      (Array.isArray(payload.items) ? payload.items : []).forEach((i) => { online[i.id] = i.online === true; });
      redraw();
      return;
    }
    if (payload.event === 'getLocale') {
      dico = payload.dictionary || {};
      localiser(document);
      // Seconde passe : les elements personnalises peuvent etre promus APRES
      // notre premier parcours, et retrouveraient alors leur libelle d'origine.
      setTimeout(() => localiser(document), 400);
      redraw();
      localeListeners.forEach((fn) => fn());
      return;
    }
    managerHandles?.(payload);
  });

  /** Ce que les autres scripts du panneau peuvent utiliser. */
  window.LumenDeckUI = {
    tr,
    el,
    send,
    client,
    sdpi,
    /** Appelle `fn` a chaque chargement du dictionnaire : le moment de redessiner les textes. */
    onLocale: (fn) => { localeListeners.push(fn); },
  };

  // Le dictionnaire, la liste et l'etat des ampoules. L'affichage ne depend
  // jamais de ces reponses pour etre lisible.
  send({ event: 'getLocale', hint: langue() });
  send({ event: 'getBulbs' });
  send({ event: 'getBulbStatus' });
})();
