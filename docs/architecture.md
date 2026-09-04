# Architecture de LumenDeck

## Vue d'ensemble

LumenDeck est un plugin Stream Deck qui pilote des ampoules Tuya **sur le réseau local**, sans
jamais joindre le cloud du fabricant. Le plugin est un processus Node autonome, lancé par
l'application Stream Deck, qui dialogue avec elle par WebSocket et avec les ampoules en TCP sur le
port 6668.

L'architecture est hexagonale au sens léger : un **contrat métier neutre** (`LightDriver`) sépare ce
que l'utilisateur veut faire (« allume », « monte à 40 % ») de la façon dont on le fait (datapoints
Tuya chiffrés). Un seul adaptateur existe aujourd'hui ; la valeur de la séparation est qu'un
adaptateur Zigbee ou Matter s'ajouterait sans toucher une seule ligne des actions.

> Annexe : la récupération de l'identifiant et de la clé locale d'une ampoule — l'unique étape
> manuelle du projet — est décrite dans [`configuration.md`](./configuration.md).

## Diagramme des couches

```
        ┌──────────────────────────────────────────────────────────┐
        │  Application Stream Deck  (processus Elgato)             │
        │  appui touche · rotation molette · panneau de réglages   │
        └───────────────────────────┬──────────────────────────────┘
                                    │  WebSocket (SDK Elgato)
        ┌───────────────────────────▼──────────────────────────────┐
        │  src/plugin.ts          COMPOSITION                      │
        │  enregistre les actions, fixe le niveau de journal,      │
        │  ferme les sessions à l'extinction                       │
        └───────────────────────────┬──────────────────────────────┘
                                    │
        ┌───────────────────────────▼──────────────────────────────┐
        │  src/actions/           PRÉSENTATION                     │
        │  toggle · brightness · color · temperature               │
        │  traduit un événement en intention métier, peint la      │
        │  touche. Ne connaît NI Tuya NI les datapoints.           │
        └───────────────────────────┬──────────────────────────────┘
                                    │  LightDriver (contrat)
        ┌───────────────────────────▼──────────────────────────────┐
        │  src/driver/pool.ts     ACCÈS PARTAGÉ                    │
        │  une connexion par ampoule, quel que soit le nombre de   │
        │  touches ; réessai unique après reconnexion              │
        └───────────────────────────┬──────────────────────────────┘
                                    │
        ┌───────────────────────────▼──────────────────────────────┐
        │  src/driver/tuya.ts     ADAPTATEUR                       │
        │  seul endroit où existent les numéros de datapoint,      │
        │  l'encodage des couleurs et les échelles Tuya            │
        └───────────────────────────┬──────────────────────────────┘
                                    │  TCP 6668, AES, protocole 3.3
        ┌───────────────────────────▼──────────────────────────────┐
        │  Ampoule Tuya sur le réseau local                        │
        └──────────────────────────────────────────────────────────┘
```

La flèche ne remonte jamais : `driver/` ignore l'existence de Stream Deck, et `actions/` ignore
l'existence de Tuya.

## Catalogue des modules

| Module | Rôle |
|---|---|
| `src/driver/types.ts` | Contrat `LightDriver` et vocabulaire métier (`LightState`, `Hsv`, `LightMode`). Exprime les grandeurs en **pourcentages et kelvins**, jamais dans les unités du transport. |
| `src/driver/tuya.ts` | Adaptateur LAN Tuya 3.3. Traduit le contrat en datapoints, encode/décode les couleurs, borne les échelles. **Seul fichier qui a le droit de connaître un numéro de DP.** |
| `src/driver/pool.ts` | Réservoir de connexions indexé par ampoule, plus `withRetry` qui rejoue une fois après reconnexion. |
| `src/actions/toggle.ts` | Action « allumer / éteindre », touche et molette. |
| `src/actions/brightness.ts` | Action « intensité » : pas fixe sur touche, rotation continue sur molette, retour visuel sur l'écran de la molette. |
| `src/actions/color.ts` | Action « couleur » : applique une couleur choisie, ou fait tourner la teinte à la molette en préservant l'intensité courante. |
| `src/actions/temperature.ts` | Action « blanc chaud / froid », de 2700 K à 6500 K. |
| `src/color-format.ts` | Conversions hexadécimal ↔ TSV et rotation de teinte. Vit côté présentation : l'hexadécimal est une convention d'interface web, pas un langage d'ampoule. |
| `src/bulbs.ts` | **Registre des ampoules**, dans les réglages globaux du plugin. Une ampoule y est déclarée une fois ; `coordinatesFor()` est le point d'entrée unique des actions. |
| `src/discovery.ts` | Écoute les annonces UDP que les ampoules Tuya diffusent d'elles-mêmes. Trouve identifiant et adresse — jamais la clé, qui n'est pas dans l'annonce. |
| `src/ui-bridge.ts` | Répond aux panneaux : lister, chercher, enregistrer, oublier une ampoule. La clé entre par ici et n'en ressort jamais. |
| `src/settings.ts` | Formes des réglages d'une touche. Une touche ne retient que l'**identifiant** de l'ampoule qu'elle pilote, plus ce qui lui est propre. |
| `src/plugin.ts` | Racine de composition. |
| `src/tools/probe.mjs` | Sonde de diagnostic : relève les datapoints d'une ampoule. Vit sous `src/` parce qu'il a besoin des dépendances du projet. |
| `tools/make_icons.py` | Génère les 20 PNG du plugin. Hors chaîne Node, d'où son emplacement séparé. |

## Le contrat `LightDriver`

Une ligne par opération ; toute implémentation doit les honorer **quel que soit le mode courant de
l'ampoule**.

| Opération | Usage concret |
|---|---|
| `read()` | Lit l'état réel. Sert à peindre une touche sans mentir sur l'état. |
| `setPower(on)` | Allume ou éteint. |
| `togglePower()` | Bascule et renvoie le nouvel état, en un aller-retour. |
| `setBrightness(pct)` | Règle l'intensité **dans le mode courant** — c'est là que se joue la valeur du projet (voir Patterns imposés). |
| `nudgeBrightness(delta)` | Ajoute un delta borné à [1, 100]. Ce dont une molette a besoin. |
| `setTemperature(kelvin)` | Passe en blanc et règle la température. |
| `setColor(hsv)` | Passe en couleur et applique la teinte. |
| `close()` | Libère la connexion. Idempotent. |

## Catalogue des datapoints Tuya (profil « dj », schéma v2)

| DP | Rôle | Plage | Remarque |
|---|---|---|---|
| `20` | Marche / arrêt | booléen | |
| `21` | Mode de travail | `white` `colour` `scene` `music` | **Détermine quel réglage commande l'intensité.** |
| `22` | Luminosité | 10 → 1000 | Actif en mode `white` uniquement. Plancher matériel à 10. |
| `23` | Température de blanc | 0 → 1000 | 0 = 2700 K, 1000 = 6500 K. **Y écrire bascule l'ampoule en `white`.** |
| `24` | Couleur | 12 caractères hexadécimaux | Teinte 0-360, saturation et valeur 0-1000, 4 hex chacune. |
| `25` | Scène | chaîne | Non exploité. |
| `26` | Minuterie | secondes | Non exploité. |
| `101` | Propriétaire, non identifié | booléen | Présent sur le modèle « LED SMART ». |

## Flux d'un appui de touche, de bout en bout

Exemple réel : l'utilisateur appuie sur une touche « Intensité » réglée à +10.

1. **Stream Deck** émet `keyDown` sur le WebSocket, avec les réglages persistés de cette touche.
2. **`Brightness.onKeyDown`** lit le pas dans les réglages (10 par défaut) et vérifie
   `isConfigured()` : sans identifiant ni clé, la touche affiche « À régler » et s'arrête là.
3. **`coordinates()`** transforme les réglages en `{ id, key, ip }`. L'adresse est facultative :
   absente, l'ampoule sera cherchée par diffusion UDP.
4. **`withRetry`** demande la connexion au réservoir. Si aucune n'existe pour cette ampoule, elle est
   ouverte ; sinon celle en cours est réutilisée.
5. **`nudgeBrightness(+10)`** lit l'état courant, calcule la cible bornée à [1, 100], appelle
   `setBrightness`.
6. **`setBrightness`** consulte le mode (DP 21) et **route** : en `colour` il réécrit la composante
   valeur du DP 24 en préservant teinte et saturation ; en `white` il écrit le DP 22 ; depuis `scene`
   ou `music` il bascule en `white` puis écrit le DP 22.
7. **`tuyapi`** chiffre la trame et l'envoie en TCP sur le port 6668.
8. **Retour** : le niveau atteint remonte jusqu'à l'action, qui écrit « 40 % » sur la touche — et sur
   l'écran de la molette si l'action tourne sur un Stream Deck+.
9. **En cas d'échec** à n'importe quelle étape, `withRetry` referme la connexion et rejoue une fois ;
   si le second essai échoue, l'action déclenche `showAlert()`. L'erreur n'est jamais avalée.

## Règles de couplage

| Depuis | Peut importer | Ne doit jamais importer |
|---|---|---|
| `src/actions/` | `driver/types`, `driver/pool`, `bulbs`, `settings`, `color-format` | `driver/tuya`, `tuyapi`, une autre action |
| `src/bulbs.ts` | `@elgato/streamdeck` (réglages globaux) | `driver/*`, `actions/*` |
| `src/discovery.ts` | `node:dgram`, `node:crypto` | tout le reste — il n'écoute que le réseau |
| `src/driver/pool.ts` | `driver/types`, `driver/tuya` | `@elgato/streamdeck`, `actions/` |
| `src/driver/tuya.ts` | `driver/types`, `tuyapi` | `@elgato/streamdeck`, `actions/`, `settings` |
| `src/driver/types.ts` | rien | tout le reste |
| `src/plugin.ts` | tout | — (c'est la racine de composition) |

## Patterns imposés

### Le routage de l'intensité selon le mode

C'est la raison d'être du pilote. Sur ces ampoules, l'intensité n'a pas un réglage mais deux, et le
mode courant décide lequel est actif. Un pilote naïf écrit toujours le DP 22 et donne l'impression
que « la molette ne fait rien » dès que l'utilisateur a choisi une couleur — c'est le défaut le plus
répandu des intégrations Tuya.

```ts
if (state.mode === 'colour' && state.color) {
  // L'intensité vit dans la composante « valeur » de la couleur.
  await set(DP.color, encodeColor({ ...state.color, v: pct }));
} else if (state.mode === 'scene' || state.mode === 'music') {
  // Choix assumé : on QUITTE la scène. Une commande sans effet visible est
  // un pire défaut qu'une commande qui change de mode.
  await set({ [DP.mode]: 'white', [DP.brightness]: pctToTuya(pct) });
} else {
  await set(DP.brightness, pctToTuya(pct));
}
```

### L'ordre d'écriture lors d'une restauration

Écrire le DP 23 bascule l'ampoule en mode blanc **de sa propre initiative**. Restaurer un état
complet en un seul lot laisse donc le mode faux. Il faut deux temps : les valeurs d'abord, le mode
en dernier.

### Le réservoir plutôt que la connexion directe

Une ampoule Tuya n'accepte qu'un nombre très restreint de connexions simultanées. Les actions
n'instancient jamais un pilote : elles passent par `withRetry(coordinates, op)`, qui gère ouverture,
partage et réessai.

## Anti-patterns à éviter

- ❌ Manipuler un numéro de datapoint hors de `driver/tuya.ts`.
- ❌ Instancier `TuyaLanDriver` dans une action.
- ❌ Déduire l'état de l'ampoule d'un compteur local plutôt que de le relire — elle est pilotable
  depuis l'application Calex et les assistants vocaux, un état supposé finit désynchronisé.
- ❌ Passer le niveau de journalisation à `trace` : les réglages contiennent la clé locale.
- ❌ Utiliser une propriété de paramètre TypeScript : cela casse l'exécution directe par Node, donc
  le test matériel sans build.
- ❌ Retoucher un PNG à la main plutôt que `tools/make_icons.py`.
- ❌ Arrondir un PNG de touche : Stream Deck arrondit lui-même, on obtient des coins morts.

## Stratégie de test

Deux étages, séparés parce qu'ils n'ont pas les mêmes prérequis.

**Tests purs** — `src/driver/__tests__/codec.test.mjs`, lancés par `npm test`. Ils couvrent les
calculs où une erreur d'un facteur dix passe inaperçue à l'œil : encodage et décodage des couleurs,
allers-retours d'échelle, plancher matériel, bornes de température. Aucune ampoule requise, donc
exécutables partout.

**Test matériel** — `src/driver/__tests__/live.integration.mjs`, lancé par `npm run test:live`. Il
valide ce qu'aucun test unitaire ne peut prouver : que l'intensité agit réellement dans chaque mode.
Son protocole est strict — relever l'état brut avant, exercer le pilote, **restaurer à l'identique**
en écrivant les valeurs puis le mode. Il vérifie lui-même l'absence de dérive et échoue s'il en
trouve une.

Un changement dans `driver/` n'est pas considéré comme vérifié tant que le test matériel n'a pas
tourné.

## Dépendances externes critiques

| Dépendance | Rôle | Risque si elle bouge |
|---|---|---|
| `@elgato/streamdeck` 2.x | Dialogue avec l'application Stream Deck | API en évolution : `LogLevel` est passé d'énumération à union de chaînes entre versions. |
| `tuyapi` 7.x | Protocole Tuya 3.3 | Type de retour de `get()` en union — d'où la vérification explicite dans `readDps()`. |
| `@elgato/cli` | Validation, installation, empaquetage | Porte aussi les gabarits officiels, source de vérité pour le format du manifeste. |
| Pillow (Python) | Génération des icônes | Hors chaîne Node : une machine sans Python ne peut pas régénérer les images, mais peut construire le plugin. |

## Le registre des ampoules

Les identifiants ne vivent pas dans les touches mais dans les **réglages globaux** du plugin. Une
touche ne retient que l'identifiant de l'ampoule qu'elle pilote ; clé et adresse sont lues dans le
registre au moment d'agir.

La première version rangeait tout dans chaque touche. Configurer quatre touches sur la même ampoule
imposait donc de saisir quatre fois les mêmes secrets — et une clé changée aurait obligé à se
souvenir de toutes les touches à corriger. `adoptLegacy()` reprend silencieusement une configuration
posée par cette version-là, pour ne rien casser à la mise à jour.

La **découverte** complète le dispositif : les ampoules Tuya diffusent leur présence en UDP toutes
les cinq secondes, sur le port 6666 en clair et le 6667 chiffré par une clé universelle publique.
On y lit l'identifiant, l'adresse et la version de protocole. Jamais la clé locale : elle n'est pas
dans l'annonce, et c'est structurel — elle reste donc à saisir une fois par ampoule.

Piège à connaître : ces annonces arrivent en **UDP entrant**. Un pare-feu qui bloque le processus
les jette avant qu'il ne les voie, et la recherche ne renvoie rien alors que l'ampoule répond
parfaitement en TCP. Symptôme trompeur, cause bête.

## Ce qui n'existe pas encore

Quatre actions couvrent l'allumage, l'intensité, la couleur et le blanc réglable. Restent hors du
périmètre : les **scènes** de l'ampoule (datapoint 25, non exploité), le pilotage de **plusieurs
ampoules par une même touche**, et tout **adaptateur autre que Tuya**.

Une contrainte matérielle à connaître plutôt qu'un manque : couleur et température **s'excluent
mutuellement**. Écrire une température fait quitter le mode couleur, et c'est l'ampoule qui
l'impose, pas le plugin.
