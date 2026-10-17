/**
 * Decisions d'etat du service Twitch : quel etat montrer apres un echec ou une annulation.
 *
 * Ce que fait ce module : deux petites decisions pures, extraites du service
 * pour etre verifiables sans Stream Deck.
 *
 * Choix non evidents :
 *
 *   - Annuler un appairage ne ramene PAS toujours a « non connecte ». Quand une
 *     session existe encore sur le disque mais que plus rien n'ecoute (acces
 *     revoque, jeton refuse), l'etat juste est « session a refaire » : c'est lui
 *     qui affiche le bouton de connexion. Restaurer l'etat d'avant en lisant
 *     l'etat courant — deja passe a « appairage » — laissait le panneau bloque.
 *
 *   - Une session expiree n'est pas une « erreur » : elle demande une action
 *     precise (se reconnecter). La presenter comme un blocage generique
 *     enfermerait le streamer devant un message sans bouton.
 *
 * Invariant : n'importe rien, pas meme le SDK.
 */
import type { Link } from './face.ts';

/**
 * L'etat a montrer quand un appairage s'arrete sans reussir.
 *
 * `clientLink` est l'etat de la liaison EN SERVICE (pas l'etat affiche), ou
 * `undefined` s'il n'y en a pas.
 */
export function restoredLink(hasSession: boolean, clientLink: Link | undefined): Link {
  if (!hasSession) return 'disconnected';
  return clientLink === 'online' || clientLink === 'connecting' ? clientLink : 'auth-needed';
}

/** L'etat et la panne a afficher pour un echec de mise en ligne, d'apres son code. */
export function failureState(code: string): { link: Link; problem: string } {
  if (code === 'reconnect-needed' || code === 'unauthorized') return { link: 'auth-needed', problem: 'reconnect-needed' };
  if (code === 'network') return { link: 'connecting', problem: 'network' };
  return { link: 'problem', problem: code };
}
