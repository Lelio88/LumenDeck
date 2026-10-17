/**
 * Point d'entree du plugin LumenDeck.
 *
 * Enregistre les actions puis ouvre le dialogue avec Stream Deck. Les connexions
 * aux ampoules sont ouvertes paresseusement, a la premiere action qui en a
 * besoin, et partagees via driver/pool.ts.
 */
import streamDeck from '@elgato/streamdeck';
import { Brightness } from './actions/brightness.js';
import { Color } from './actions/color.js';
import { ScenarioAction } from './actions/scenario.js';
import { Temperature } from './actions/temperature.js';
import { ToggleBulb } from './actions/toggle.js';
import { TwitchAction } from './actions/twitch.js';
import { releaseAll } from './driver/pool.js';
import { stopAll } from './scenarios/runner.js';
import * as twitch from './twitch/service.js';
import { installUiBridge } from './ui-bridge.js';

// INFO plutot que TRACE : le mode trace journalise tous les echanges avec Stream
// Deck, or les reglages des actions transportent la local_key des ampoules. Ce
// secret n'a rien a faire dans un fichier de journal sur le disque.
// LogLevel est une union de chaines dans le SDK v2, pas une enumeration :
// aucun import n'est necessaire.
streamDeck.logger.setLevel('info');

streamDeck.actions.registerAction(new ToggleBulb());
streamDeck.actions.registerAction(new Brightness());
streamDeck.actions.registerAction(new Color());
streamDeck.actions.registerAction(new Temperature());
streamDeck.actions.registerAction(new ScenarioAction());
streamDeck.actions.registerAction(new TwitchAction());

// Repond aux panneaux de configuration : liste, recherche et enregistrement
// des ampoules connues.
installUiBridge();

// Referme proprement les sessions Tuya a l'extinction : une connexion laissee
// ouverte empeche l'application Calex de reprendre la main sur l'ampoule.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    // Couper les scenarios AVANT de fermer les connexions : le moteur a besoin
    // des sessions Tuya pour remettre chaque lampe comme il l'a trouvee.
    twitch.shutdown();
    void stopAll().finally(() => releaseAll().finally(() => process.exit(0)));
  });
}

// Rouvre la session Twitch s'il en existe une, APRES la connexion : lire les
// reglages globaux suppose que Stream Deck repond. Un echec ne doit jamais
// empecher les touches de fonctionner : Twitch est un plus, pas un prerequis.
void streamDeck.connect()
  .then(() => twitch.init())
  .catch((error: unknown) => {
    streamDeck.logger.createScope('plugin').warn('demarrage impossible : ' + (error instanceof Error ? error.name : 'erreur'));
  });
