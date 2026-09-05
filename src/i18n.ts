/**
 * Traduction des textes que le plugin affiche.
 *
 * Ce que fait ce module : donner un raccourci unique vers le dictionnaire charge
 * par le SDK, pour que les actions n'aient ni a importer `streamDeck` ni a
 * repeter le chemin.
 *
 * Choix non evident : les cles sont STRUCTUREES (`key.off`, `scenario.orage.name`)
 * et non des phrases anglaises. Une phrase en guise de cle se corrige un jour
 * pour un detail de style, et toutes les traductions retombent alors
 * silencieusement sur l'anglais — une panne invisible tant qu'on ne change pas
 * la langue de Stream Deck. Le manifeste, lui, n'a pas le choix : c'est Stream
 * Deck qui y cherche la chaine anglaise telle quelle.
 *
 * Ou vivent les traductions : `<langue>.json` a la racine du dossier plugin,
 * produits par `tools/make_locales.py`. Ils ne s'editent pas a la main, pour la
 * meme raison que les PNG.
 *
 * Repli : une cle absente est rendue telle quelle. C'est voulu — une touche qui
 * affiche `key.off` signale une traduction manquante bien plus clairement
 * qu'une touche vide.
 *
 * Usage canonique :
 *   await action.setTitle(t('key.offline'));
 */
import streamDeck from '@elgato/streamdeck';

/** Traduit une cle dans la langue courante de Stream Deck. */
export function t(key: string): string {
  return streamDeck.i18n.translate(key);
}

/** Nom traduit d'un scenario, depuis son identifiant. */
export function scenarioName(id: string): string {
  return t('scenario.' + id + '.name');
}
