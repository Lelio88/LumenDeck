/**
 * Index des sessions de scenario, par ampoule.
 *
 * Ce que fait ce module : retrouver la session qui occupe une lampe, depuis
 * N'IMPORTE LAQUELLE des lampes de cette session.
 *
 * Choix non evidents :
 *
 *   - Une session figure sous la cle de CHAQUE lampe. Indexer la seule ampoule
 *     principale laissait une lampe secondaire joignable par deux scenarios a la
 *     fois, qui se battaient image par image.
 *
 *   - `remove` ne retire une cle que si elle POINTE ENCORE sur cette session.
 *     Deux scenarios qui se recoupent (S2 sur [B, C], S3 sur [C, D]) partagent la
 *     lampe C : arreter l'ancien ne doit pas rendre le nouveau introuvable, sinon
 *     il tourne sans plus pouvoir etre arrete.
 *
 * N'importe RIEN : la regle se verifie sans Stream Deck ni ampoule.
 *
 * Usage canonique :
 *   const registry = createRegistry<Session>();
 *   registry.add(session);
 *   registry.get(anyBulbId)?.scenarioId;
 */

/** Le peu qu'il faut savoir d'une session pour l'indexer. */
export type Indexable = { readonly targets: readonly { readonly id: string }[] };

export function createRegistry<S extends Indexable>() {
  const byBulb = new Map<string, S>();

  return {
    /** La session qui occupe cette lampe, ou undefined. */
    get: (bulbId: string): S | undefined => byBulb.get(bulbId),

    /** Inscrit la session sous chacune de ses lampes, en reprenant celles qu'elle partage. */
    add(session: S): void {
      for (const target of session.targets) byBulb.set(target.id, session);
    },

    /** Libere les lampes qui pointent encore sur cette session, et elles seules. */
    remove(session: S): void {
      for (const target of session.targets) {
        if (byBulb.get(target.id) === session) byBulb.delete(target.id);
      }
    },

    /** Chaque session une seule fois, quel que soit son nombre de lampes. */
    unique: (): S[] => [...new Set(byBulb.values())],
  };
}
