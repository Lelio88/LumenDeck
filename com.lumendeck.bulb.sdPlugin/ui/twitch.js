/**
 * Panneau de la touche Twitch : connexion du compte et etat de la recompense.
 *
 * Ce que fait ce script : afficher l'etat que le plugin lui envoie, et lui
 * transmettre les quatre gestes possibles — connecter, annuler, deconnecter,
 * demander l'etat.
 *
 * Choix non evidents :
 *
 *   - Le panneau ne decide RIEN et ne garde aucun etat : il montre ce que dit
 *     le plugin (`twitchStatus`), qui est la seule source de verite. L'appairage
 *     se deroule dans le plugin, pas ici — un panneau qu'on ferme en plein
 *     appairage ne doit pas l'interrompre.
 *
 *   - Aucun texte n'est construit en JavaScript : toutes les phrases sont dans
 *     la page, avec leur cle de traduction, et ce script se contente de les
 *     afficher ou de les masquer. La traduction est faite par bulbs.js, qui
 *     charge le dictionnaire une fois pour tous les panneaux.
 *
 *   - Rien de secret n'arrive ici : le plugin n'envoie que l'etat (connecte ou
 *     non, nom du compte, code a saisir, derniere action). Jamais un jeton.
 *
 *   - Le nom du viewer vient d'un inconnu : il est ecrit par `textContent`,
 *     jamais interprete comme du HTML.
 */
(() => {
  const client = window.SDPIComponents?.streamDeckClient;
  const root = document.getElementById('tw');
  if (!client || !root) return;

  const $ = (id) => document.getElementById(id);
  const send = (payload) => client.send('sendToPlugin', payload);

  /** Les pannes dont le texte existe ; les autres retombent sur le message generique. */
  const ALIAS = { unauthorized: 'reconnect-needed' };

  const show = (el, visible) => { el.hidden = !visible; };

  function render(status) {
    const link = status.link;
    show($('tw-off'), link === 'disconnected' || link === 'auth-needed');
    show($('tw-pairing'), link === 'pairing');
    // Un blocage connu (titre de recompense deja pris) se leve hors du panneau : on propose de reessayer.
    show($('tw-on'), link === 'connecting' || link === 'online' || link === 'problem');
    show($('tw-retry'), link === 'problem');

    $('tw-code').textContent = status.pairing ? status.pairing.userCode : '';
    $('tw-login').textContent = status.login || '';
    // « La recompense est active » n'est vrai que si l'ecoute l'est aussi.
    show($('tw-reward-ok'), Boolean(status.rewardReady) && link === 'online');
    show($('tw-reward-wait'), !status.rewardReady && link === 'connecting' && !status.problem);

    const last = status.last;
    show($('tw-last'), Boolean(last));
    if (last) {
      $('tw-last-user').textContent = last.user;
      document.querySelectorAll('#tw-last [data-outcome]').forEach((el) => {
        el.hidden = el.dataset.outcome !== last.outcome;
      });
    }

    const problem = status.problem;
    show($('tw-problem'), Boolean(problem));
    if (problem) {
      const code = ALIAS[problem] || problem;
      const known = Boolean(document.querySelector('#tw-problem [data-code="' + CSS.escape(code) + '"]'));
      document.querySelectorAll('#tw-problem [data-code]').forEach((el) => {
        el.hidden = el.dataset.code !== (known ? code : 'generic');
      });
    }
  }

  $('tw-connect').addEventListener('click', () => send({ event: 'twitchConnect' }));
  $('tw-cancel').addEventListener('click', () => send({ event: 'twitchCancel' }));
  $('tw-disconnect').addEventListener('click', () => send({ event: 'twitchDisconnect' }));
  $('tw-retry').addEventListener('click', () => send({ event: 'twitchRetry' }));

  client.sendToPropertyInspector.subscribe((event) => {
    const payload = event?.payload;
    if (payload && payload.event === 'twitchStatus') render(payload);
  });

  // Etat initial : le plugin repond par un `twitchStatus`.
  send({ event: 'twitchStatus' });
})();
