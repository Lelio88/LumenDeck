# LumenDeck — Contexte d'Opération et Garde-Fous Agentiques

Résolvez les problèmes sans introduire de régression ni de dette technique architecturale.

## I. Finalité

**Application** : LumenDeck — plugin Stream Deck (Elgato) de pilotage d'ampoules connectées.
**Objectif métier** : commander une ampoule Tuya (gamme Calex Smart et compatibles) depuis une
touche ou une molette, **en LAN, sans cloud**. L'aller-retour mesuré est de ~23 ms, contre plusieurs
centaines via l'API cloud Tuya — c'est cette réactivité qui justifie le projet.

## II. Architecture

**Modèle** : hexagonal léger. Un contrat métier neutre (`LightDriver`) isole les actions Stream Deck
du protocole ; un seul adaptateur existe aujourd'hui (Tuya LAN), d'autres (Zigbee, Matter) se
brancheraient sans toucher aux actions.

**Détails complets** (couches, flux, datapoints, couplage, compatibilité, langues, tests) : voir [`docs/architecture.md`](./docs/architecture.md).

Topologie rapide :
- `src/driver/` — contrat `LightDriver`, adaptateur Tuya, réservoir de connexions
- `src/actions/` — une classe par action Stream Deck ; ne connaît que le contrat
- `src/scenarios/` — catalogue d'animations en données pures, et moteur qui les déroule
- `src/plugin.ts` — composition : enregistre les actions, ouvre le dialogue Stream Deck
- `com.lumendeck.bulb.sdPlugin/` — manifeste, images, panneaux de configuration (versionné)
- `tools/` — génération des icônes ; `src/tools/` — sondes de diagnostic (ont besoin des deps)

## III. Pile Technologique

*Versions contraintes par `package.json`. N'introduisez aucune dépendance alternative sans approbation.*

- **Langage** : TypeScript 5.9 — **pas la 7.x**, le gabarit officiel Elgato épingle la 5
- **Exécution** : Node **≥ 24**, imposé par le SDK et déclaré dans le manifeste
- **SDK** : `@elgato/streamdeck` 2.x (SDKVersion 3, Stream Deck ≥ 7.1)
- **Protocole** : `tuyapi` 7.x — protocole Tuya 3.3, connexion LAN chiffrée
- **Build** : Rollup + `@rollup/plugin-typescript`, calqué sur le gabarit `@elgato/cli`
- **Icônes** : Python 3.11 + Pillow (hors chaîne Node, script autonome)

## IV. Garde-Fous non négociables

1. **Aucun numéro de datapoint hors de `src/driver/tuya.ts`.** Les DPS Tuya (`20`, `21`, `24`…)
   sont un détail de protocole. Une action qui en manipule un a franchi la frontière.
2. **Ne jamais construire un `TuyaLanDriver` directement** — passer par `acquire()` ou `withRetry()`.
   Une ampoule Tuya n'accepte qu'une poignée de connexions ; les échecs qui suivent sont erratiques.
3. **Ne jamais journaliser la `local_key`.** C'est pourquoi le niveau de journalisation est `info`
   et non `trace` : le mode trace enregistre tous les échanges, réglages compris.
4. **Pas de propriété de paramètre TypeScript** (`constructor(private x: T)`) : Node ne sait pas la
   transformer, et l'éviter permet de **tester le pilote sans étape de build**.
5. **L'ampoule est seule maîtresse de son état.** Après une écriture, relire plutôt que déduire :
   elle peut avoir été changée depuis l'application Calex ou un assistant vocal.
6. **Les secrets vivent dans `../.lumendeck-secrets/`**, jamais dans le dépôt.
7. **PNG et `<langue>.json` sont générés** — par `tools/make_icons.py` et `tools/make_locales.py`, jamais à la main.

## V. Flux de Travail (Explore → Plan → Code → Verify)

1. **Exploration** — lire les fichiers adjacents pour calquer les patterns
2. **Planification** — soumettre l'approche à l'utilisateur pour les changements non triviaux
3. **TDD** — écrire le test en premier, vérifier qu'il échoue, **ne plus l'altérer**
4. **Implémentation** — code minimal pour faire passer le test
5. **Vérification** — `npm test && npm run build && npx streamdeck validate com.lumendeck.bulb.sdPlugin`
   puis, si le pilote a changé, `npm run test:live` sur une ampoule réelle

**Auto-documentation (règle transverse)** — tout nouveau module publie en tête un commentaire-doc :
ce qu'il fait en une phrase, les choix non-évidents **et leur motivation**, les invariants à préserver,
un exemple d'usage si l'API n'est pas évidente. La rationale doit survivre au refactor.

## VI. Commandes de Développement

```bash
npm run build          # bundle vers com.lumendeck.bulb.sdPlugin/bin/
npm run watch          # reconstruit et redémarre le plugin à chaque sauvegarde
npm test               # tests unitaires purs (aucune ampoule requise)
npm run test:live      # test d'intégration sur ampoule réelle, restaure son état
npm run probe          # relève les datapoints d'une ampoule (diagnostic)
py -3.11 tools/make_icons.py                        # régénère les icônes
py -3.11 tools/make_locales.py                      # régénère les 5 dictionnaires
npx streamdeck validate com.lumendeck.bulb.sdPlugin # contrôle manifeste + images
npx streamdeck link com.lumendeck.bulb.sdPlugin     # installe dans Stream Deck
npx streamdeck restart com.lumendeck.bulb           # recharge après build
```

## VII. Maintenance documentaire

**Règle d'or** : le diff du code et celui de la doc correspondante vont dans **le même commit**.

| Modification | Fichier à mettre à jour |
|---|---|
| Nouveau datapoint ou modèle d'ampoule géré | Catalogue DPS de `docs/architecture.md` + `src/driver/tuya.ts` |
| Nouvelle action Stream Deck | `manifest.json` + `src/plugin.ts` + catalogue de `docs/architecture.md` |
| Nouveau réglage d'action | `src/settings.ts` + le panneau `ui/*.html` correspondant |
| Nouvel adaptateur (Zigbee, Matter) | Section « Adaptateurs » de `docs/architecture.md` |
| Retouche d'icône | `tools/make_icons.py` — **jamais** le PNG |
| Nouveau texte affiché à l'utilisateur | `tools/make_locales.py` — **jamais** un `<langue>.json` |
| Nouvel anti-pattern découvert | Section « Anti-patterns » de `docs/architecture.md` |
| Changement de dépendance critique | Section III ci-dessus + `package.json` |

## VIII. Contexte de Session

- **Dernier focus** : —
- **Focus immédiat** : —
