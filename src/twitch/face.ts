/**
 * Ce que la touche Twitch doit montrer selon l'etat du service.
 *
 * Ce que fait ce module : transformer (etat de la liaison, pause) en un mode de
 * dessin et une cle de mot.
 *
 * Choix non evidents :
 *
 *   - Seul l'etat « les viewers peuvent agir » est ambre. Une touche ambre qui
 *     mentirait (pause, session morte) ferait croire au streamer que ses
 *     viewers controlent la piece alors que chaque rachat est rembourse.
 *
 *   - La PAUSE l'emporte sur les pannes de liaison : un streamer qui a coupe
 *     volontairement les viewers doit lire « Pause », pas « Erreur » parce que
 *     le reseau a bronche.
 *
 *   - Une reconnexion en cours est muette : elle dure quelques secondes, et un
 *     mot d'alerte pour un etat aussi bref apprendrait a l'ignorer.
 *
 * Invariant : n'importe rien, pas meme le SDK ni les traductions — elle rend une
 * CLE, que l'action traduit. Se verifie donc sans Stream Deck.
 */
export type Link = 'disconnected' | 'pairing' | 'connecting' | 'online' | 'auth-needed' | 'problem';

export type TwitchFace = {
  readonly mode: 'live' | 'paused' | 'idle';
  /** Cle de traduction du mot, ou chaine vide pour aucun mot. */
  readonly wordKey: string;
};

export function twitchFace(link: Link, paused: boolean): TwitchFace {
  if (paused) return { mode: 'paused', wordKey: 'key.paused' };
  switch (link) {
    case 'online': return { mode: 'live', wordKey: '' };
    case 'connecting': return { mode: 'idle', wordKey: '' };
    case 'problem': return { mode: 'idle', wordKey: 'key.error' };
    default: return { mode: 'idle', wordKey: 'key.toSet' };
  }
}
