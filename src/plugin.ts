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
import { Temperature } from './actions/temperature.js';
import { ToggleBulb } from './actions/toggle.js';
import { releaseAll } from './driver/pool.js';

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

// Referme proprement les sessions Tuya a l'extinction : une connexion laissee
// ouverte empeche l'application Calex de reprendre la main sur l'ampoule.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void releaseAll().finally(() => process.exit(0));
  });
}

streamDeck.connect();
