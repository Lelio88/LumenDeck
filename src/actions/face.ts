/**
 * Ce que la face d'une action doit montrer, selon le controleur.
 *
 * Ce que fait ce module : trancher entre DEUX verites egalement defendables —
 * la valeur que la touche appliquera, et celle que la lampe affiche en ce
 * moment.
 *
 * LE CHOIX NON EVIDENT, ET LA RAISON D'ETRE DU FICHIER : sur une TOUCHE, c'est
 * sa propre valeur qui doit s'afficher. Deux touches pointant la meme ampoule
 * doivent rester distinguables, faute de quoi on ne sait plus laquelle fait
 * quoi — et le doute naît precisement apres en avoir presse une, puisque la
 * lampe prend alors la valeur de celle-la et que l'autre se met a mentir. Avec
 * une lampe verte, une touche « violet » qui s'affiche en vert n'annonce plus
 * rien du tout.
 *
 * Sur une MOLETTE, c'est l'inverse : la rotation part de la valeur courante de
 * la lampe, et un ecran qui la contredirait priverait le geste de sens.
 *
 * CE QUI NE SE DECIDE PAS ICI : l'etat allume / eteint. Il vient toujours de la
 * lampe, dans les deux cas — c'est lui qui assombrit le dessin, et lui seul
 * decrit vraiment l'ampoule.
 *
 * N'importe RIEN, pas meme le SDK : c'est ce qui permet de verifier la regle
 * sans Stream Deck ni ampoule, la ou elle vivait auparavant en double dans deux
 * actions, hors de portee de tout test.
 *
 * Usage canonique :
 *   await paint(target, faceValue(target, state.color, configured(settings)), state.on);
 */

/**
 * Le peu qu'il faut connaitre d'une touche pour trancher.
 *
 * Type STRUCTUREL plutot qu'un import du SDK : c'est ce qui garde ce module
 * chargeable par Node, et un objet vide suffit alors a jouer une touche.
 */
export type Surface = {
  /** N'existe que sur une molette : l'ecran du Stream Deck+. */
  readonly setFeedback?: unknown;
};

/**
 * Vrai si la surface est une molette.
 *
 * Reconnue a son ecran plutot qu'a un type declare : c'est l'idiome deja
 * employe par les fonctions de dessin, et il ne depend d'aucune enumeration du
 * SDK susceptible de bouger.
 */
export function isDial(target: Surface): boolean {
  return typeof target.setFeedback === 'function';
}

/**
 * La valeur a peindre.
 *
 * `current` est ce que la lampe affiche (nul si elle n'en a pas : une ampoule en
 * blanc n'a pas de couleur), `chosen` ce que la touche appliquerait.
 */
export function faceValue<T>(target: Surface, current: T | null | undefined, chosen: T): T {
  return isDial(target) ? current ?? chosen : chosen;
}
