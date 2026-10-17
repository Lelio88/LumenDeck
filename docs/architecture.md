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
        │  toggle · brightness · color · temperature · scenario    │
        │  traduit un événement en intention métier, peint la      │
        │  touche. Ne connaît NI Tuya NI les datapoints.           │
        └───────────────────────────┬──────────────────────────────┘
                                    │
        ┌───────────────────────────▼──────────────────────────────┐
        │  src/scenarios/         DÉROULEMENT DANS LE TEMPS        │
        │  catalogue de données pures + moteur qui joue les images │
        │  (traversée par la seule action « scénario » ; les       │
        │  quatre autres descendent directement au réservoir)      │
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
| `src/driver/pool.ts` | Réservoir de connexions indexé par ampoule, plus `withRetry` qui rejoue une fois après reconnexion, en conservant la cause la plus précise des deux tentatives. |
| `src/driver/errors.ts` | Vocabulaire des pannes : `LightFailure` (quatre causes), `LightError`, `classify()`. Traduit les messages de `tuyapi` en causes que l'utilisateur peut distinguer. N'importe rien. |
| `src/actions/failure.ts` | Report d'une panne : un mot sur la touche, la cause complète au journal. Point de passage unique des cinq actions (`logFailure` nomme, au journal seulement, chaque lampe d'un groupe qui a failli). |
| `src/actions/face.ts` | Tranche entre la valeur de la touche et celle de la lampe, selon le contrôleur. N'importe rien — la règle est vérifiable sans Stream Deck ni ampoule. |
| `src/actions/recovery.ts` | Cycle de reprise des touches en panne : relecture replanifiée avec attente croissante, éteinte dès que ça repart. N'importe rien — testable avec des minuteries simulées. |
| `src/actions/group.ts` | **Plusieurs ampoules par touche** : `selectedIds` (la liste cochée, avec reprise des anciens champs `deviceId`/`deviceId2`), `adoptGroup` (recopie les anciens champs dans la liste), `fanOut` (applique une opération à chaque lampe en parallèle sans qu'une panne n'en prive les autres), `nextPower` (un groupe dont une lampe est allumée s'éteint). N'importe rien — testable sans Stream Deck ni ampoule. |
| `src/actions/run.ts` | `applyToAll` : le geste unique des cinq actions pour « fais ceci sur mes lampes ». **Appui strict** (une lampe en défaut → alerte et mot sur la touche), **relecture tolérante** (la touche se dessine d'après les lampes qui répondent). Le journal nomme chaque lampe en défaut. |
| `src/actions/power.ts` | `toggleAll` : bascule d'allumage partagée. Une ampoule garde son aller-retour unique (`togglePower`) ; un groupe lit l'état de chacune puis décide pour tous. |
| `src/actions/toggle.ts` | Action « allumer / éteindre », touche et molette. |
| `src/actions/brightness.ts` | Action « intensité » : pas fixe sur touche, rotation continue sur molette, retour visuel sur l'écran de la molette. |
| `src/actions/color.ts` | Action « couleur » : applique une couleur choisie, ou fait tourner la teinte à la molette en préservant l'intensité courante. |
| `src/actions/temperature.ts` | Action « blanc chaud / froid », de 2700 K à 6500 K. |
| `src/actions/twitch.ts` | Action « Twitch » : tableau de bord des points de chaîne. Montre si les viewers peuvent agir, un appui les met en pause. Son panneau porte la connexion du compte, les ampoules des viewers et le choix des récompenses (palette, couleur surprise, saisie libre, scénarios, durée selon le prix). |
| `src/actions/scenario.ts` | Action « scénario » : un appui lance une animation, un second l'arrête. N'entretient aucun état local — elle interroge le moteur, ce qui garde deux touches d'accord sur la même ampoule. |
| `src/scenarios/catalogue.ts` | Les scénarios eux-mêmes, en **données pures**. Chacun a deux écritures : `frame(step)`, ce que fait une lampe, et `group(step, count)`, le scénario écrit pour toute la pièce (chenillard, vague, arc-en-ciel étalé, éclair qui frappe une lampe). `frameFor` choisit selon « les ampoules jouent ensemble ». Testable sans ampoule ; en ajouter un ne touche pas au moteur. |
| `src/scenarios/sessions.ts` | Index des sessions de scénario **par ampoule** : une session est retrouvable depuis chacune de ses lampes, et `remove` ne libère que les lampes qui pointent encore sur elle. N'importe rien — testable seul. |
| `src/scenarios/runner.ts` | Déroule les images dans le temps. Une exécution par ampoule — une session est retrouvable depuis **chacune** de ses ampoules —, relevé de l'état avant la première image et restauration à l'arrêt. Options : `together` (version de groupe) et `maxMs`, une durée après laquelle le scénario s'arrête seul et rend les lampes dans leur état d'avant (scénarios achetés par un viewer). |
| `src/key-art.ts` | Dessine les faces de touche **à la volée**, en SVG : jauge qui se remplit, goutte à la vraie couleur, disque teinté à la vraie température. N'importe rien — donc testable sans ampoule ni Stream Deck. |
| `src/color-format.ts` | Conversions hexadécimal ↔ TSV et rotation de teinte. Vit côté présentation : l'hexadécimal est une convention d'interface web, pas un langage d'ampoule. |
| `src/bulbs.ts` | **Registre des ampoules** (identifiant, clé, adresse, nom, **version de protocole**), dans les réglages globaux du plugin. Une ampoule y est déclarée une fois ; `coordinatesForMany()` est le point d'entrée unique des actions et rend les coordonnées des ampoules d'une touche, dans l'ordre ; `adoptBulbs()` met une ancienne touche à jour à son apparition. |
| `src/discovery.ts` | Écoute les annonces UDP que les ampoules Tuya diffusent d'elles-mêmes. Trouve identifiant et adresse — jamais la clé, qui n'est pas dans l'annonce. |
| `src/ui-bridge.ts` | Répond aux panneaux : lister les ampoules et dire lesquelles répondent, chercher, enregistrer, oublier ; relayer la connexion Twitch et la pause. La clé entre par ici et n'en ressort jamais. |
| `src/settings.ts` | Formes des réglages d'une touche. Une touche ne retient que les **identifiants** (`deviceIds`) des ampoules qu'elle pilote, plus ce qui lui est propre. |
| `src/plugin.ts` | Racine de composition. |
| `src/tools/probe.mjs` | Sonde de diagnostic : relève les datapoints d'une ampoule. Vit sous `src/` parce qu'il a besoin des dépendances du projet. |
| `src/tuya-cloud.ts` | Récupère les clés locales par **scan de QR code**. Parle à Tuya, et seulement pour l'enrôlement : le pilotage n'y repasse jamais. |
| `src/global-store.ts` | Magasin des **réglages globaux**, par clé : la lecture, le calcul de la nouvelle valeur et l'écriture ont lieu **dans la même file**, avec un délai maximal sur la lecture. `setGlobalSettings` remplace l'objet entier : sérialiser les seules écritures ne suffit pas, deux modifications simultanées liraient le même état de départ et la seconde effacerait la première (une clé locale saisie peut ainsi disparaître). Pur — testable avec un faux disque. |
| `src/globals.ts` | Liaison du magasin au SDK. Toute lecture et toute écriture des réglages globaux passent par là. |
| `src/registry.ts` | Fusion pure des ampoules du registre (ajout, mise à jour, oubli). Une fonction de la liste **courante** : `bulbs.ts` la confie au magasin, qui l'applique dans sa file. Une découverte réseau, qui ignore la clé, n'efface jamais une clé déjà saisie. |
| `src/twitch/viewer-color.ts` | Lit le texte tapé par un viewer : un nom de couleur (français, anglais, allemand, espagnol, italien) ou un hexadécimal **avec** `#`, rien d'autre ; le noir est refusé. Pur, ne lève jamais. |
| `src/twitch/protocol.ts` | Lit les messages EventSub : bienvenue, maintien, rachat, reconnexion, révocation. Ne rend un rachat que s'il est encore à traiter ; n'accepte une adresse de reconnexion que chez `twitch.tv`. Pur. |
| `src/twitch/eventsub.ts` | Connexion temps réel : chien de garde sur le silence, reconnexion à délai croissant, bascule sans perte sur demande de Twitch. Socket, horloge et abonnement injectés. |
| `src/twitch/auth.ts` | Connexion du compte (code à saisir, application **publique**, aucun secret) et renouvellement des jetons. Réseau, horloge et attente injectés. |
| `src/twitch/helix.ts` | Appels à l'API Twitch : créer, lister, supprimer la récompense ; s'abonner aux rachats ; valider ou rembourser un rachat (avec reprises sur panne passagère) ; lister les rachats restés en attente. Erreurs classées, jamais de jeton dans un message. |
| `src/twitch/handler.ts` | La décision pour chaque rachat : appliquer la couleur (fixe, surprise ou tapée) ou lancer le scénario acheté, puis valider, **ou** rembourser avec sa raison. Un par un, dans l'ordre ; chaque rachat une seule fois ; un rachat d'une récompense qui n'est pas au plugin est ignoré sans être lu. Effets injectés. |
| `src/twitch/face.ts` | Ce que la touche Twitch montre selon l'état du service. Rend une clé de traduction, pas un mot. Pur. |
| `src/twitch/rewards.ts` | Le catalogue des récompenses : la palette de 9 couleurs, et la traduction des choix du panneau en récompenses à créer (une par couleur, scénario, surprise, saisie libre), chacune repérée par une **clé** stable (`color:rouge`, `scenario:orage`…), jamais par son titre. Nettoie les réglages venus du panneau, calcule la durée d'un scénario d'après le prix payé, et `planRewards` dit quoi garder, créer et supprimer chez Twitch (reprise par titre après réinstallation, jamais de suppression d'une récompense inconnue). Pur. |
| `src/twitch/state.ts` | Quel état montrer après un échec ou une annulation d'appairage : une session encore présente mais sans écoute redevient « à refaire » au lieu de bloquer le panneau. Pur. |
| `src/twitch/service.ts` | La colle, seule partie liée au SDK : session persistée, renouvellement sérialisé, récompense, socket, ampoules visées. Aucune règle métier — elles sont dans les modules ci-dessus. |
| `src/i18n.ts` | Raccourci unique vers le dictionnaire du SDK. Les clés y sont **structurées** (`key.off`), jamais des phrases : une phrase corrigée pour un détail de style ferait retomber toutes les traductions sur l'anglais, en silence. |
| `ui/bulbs.js` | Socle des panneaux : traduction, liste des ampoules de la touche (pastille en ligne / hors ligne, ordre par flèches avec `data-ordered`) et gestionnaire « Mes ampoules / Ajouter ». Écrit `deviceIds` par `SDPIComponents.useSettings`, qui partage le stockage des composants sdpi : écrire les réglages autrement les ferait s'écraser avec une copie périmée. |
| `tools/make_promo.mjs` | Compose les visuels de présentation. Les faces de touches y viennent de `key-art.ts`, **le module que le plugin appelle vraiment** : une image promotionnelle dessinée à part finit par mentir dès que le produit évolue. |
| `tools/make_locales.py` | Produit les cinq `<langue>.json` depuis une table unique où chaque texte figure dans toutes les langues. Une entrée incomplète fait **échouer** la génération. |
| `tools/make_icons.py` | Génère les 24 PNG du plugin. Hors chaîne Node, d'où son emplacement séparé. |
| `tools/preflight.mjs` | Contrôle la chaîne de développement avant `test`, `build`, `watch` et `deploy` : dépendances installées, binaire présent, **et `node_modules/.bin` réellement dans le PATH**. Silencieux quand tout va bien. N'importe que des modules natifs — il doit tourner quand les dépendances manquent. |

## Le cloud, une seule fois

La clé locale d'une ampoule est créée par l'application du fabricant à l'appairage, et n'existe
nulle part ailleurs. Aucune ampoule ne la divulgue : la découverte UDP rapporte l'identifiant et
l'adresse, **jamais la clé**. Il faut donc la demander à Tuya.

`src/tuya-cloud.ts` le fait **une fois**, au moment de l'enrôlement, par le mécanisme officiel de
partage d'appareils : l'utilisateur scanne un QR code dans son application, et le compte autorise le
partage. On emprunte pour cela l'enregistrement applicatif public de l'intégration Home Assistant —
ce n'est pas un contournement, c'est ce qui évite à l'utilisateur de créer un compte développeur.

**Ce que le cloud ne fait jamais** : allumer, changer une couleur, jouer un scénario, lire un état.
Tout cela passe par le réseau local. Le jour où Tuya fermerait cette porte, les ampoules déjà
enregistrées continueraient de fonctionner — seul l'ajout d'une nouvelle ampoule reviendrait à la
procédure manuelle.

Deux régimes coexistent dans le protocole, relevés dans le SDK Python officiel de Tuya et non
devinés : la connexion par QR code n'est ni signée ni chiffrée, tandis que la lecture des appareils
est signée (HMAC-SHA256) **et** chiffrée (AES-128-GCM) avec un secret dérivé à chaque requête. Une
erreur d'un octet ne produirait pas un bug visible mais un refus serveur laconique — d'où les tests
qui vérifient l'algorithme contre des vecteurs calculés à part.

**Invariant** : la clé ne quitte jamais le plugin. `fetchDevices` la rend au pont d'interface, qui
l'écrit directement dans le registre ; le panneau, lui, n'apprend que des noms.

**L'adresse du cloud est ignorée.** Le cloud rapporte une adresse pour chaque appareil, mais c'est celle
de la box vue d'Internet, pas celle de l'ampoule : s'y connecter expire et la touche affiche « Hors
ligne » alors que la clé est bonne. L'enrôlement n'enregistre donc **aucune** adresse ; l'écoute des
annonces UDP (`locateEnrolled`, en arrière-plan) la renseigne ensuite, et à défaut le pilote cherche
l'ampoule par diffusion à chaque connexion.

## Twitch : les points de chaîne

Les viewers dépensent des points de chaîne pour choisir la couleur des ampoules. Le plugin parle
alors à Twitch — c'est la seule autre porte ouverte vers l'extérieur, avec l'enrôlement Tuya.

**Ce que Twitch fait, et ne fait jamais.** Il apprend au plugin qu'un viewer a payé, et permet de
clore ce rachat. Il ne commande **jamais** une lampe : le rachat arrive au plugin comme un message,
le plugin en déduit une couleur ou un scénario, puis l'applique aux ampoules **en LAN**, comme
n'importe quelle touche.

**Les récompenses.** Twitch n'a pas de sélecteur de couleur : un viewer ne peut que cliquer un
bouton, ou taper un texte. Chaque choix du panneau devient donc **sa** récompense : une par couleur
cochée dans la palette, « Couleur surprise » (tirée au hasard), « Choisis la couleur » (le viewer
écrit), et une par scénario coché. Seule la saisie libre fait écrire le viewer. Un scénario acheté
dure `prix ÷ 100 × secondes pour 100 points`, entre 5 s et le plafond du panneau, puis les lampes
reviennent à leur état d'avant : le streamer change le prix dans son tableau de bord Twitch et la
durée suit, le prix venant du rachat lui-même. Les récompenses **suivent le panneau** : cocher crée,
décocher supprime, un instant après le dernier clic. Les synchronisations passent **une par une**
(deux en parallèle créeraient deux fois la même récompense) ; un changement fait pendant la
connexion est rejoué dès qu'elle aboutit ; une suppression qui échoue garde la récompense en
service et sera retentée. Sans réglage du panneau, ce sont les choix par défaut qui s'appliquent
(cinq couleurs, surprise, saisie libre, cinq scénarios) : ils sont **créés** chez Twitch à la
première connexion, comme le panneau les montre cochés.

**Couleur contre scénario.** Une couleur achetée arrête le scénario en cours sur les mêmes lampes,
même s'il a été acheté par un autre viewer : sa prochaine image effacerait sinon la couleur. Un
scénario qui n'atteint **aucune** lampe à sa première image est arrêté et le viewer remboursé.

**Un abonnement pour toute la chaîne.** Un abonnement par récompense obligerait à suivre chaque case
du panneau. Le plugin reçoit donc tous les rachats de la chaîne, et ignore **sans les lire** ceux des
récompenses qui ne sont pas les siennes : ni texte journalisé, ni texte affiché.
Aucune lecture du chat : les deux seules permissions demandées sont `channel:read:redemptions` et
`channel:manage:redemptions`, et le plugin vérifie à la connexion que les deux ont été accordées.

**Le flux d'un rachat.**

1. Le viewer rachète une récompense du plugin (et tape un texte, pour la saisie libre).
2. `eventsub.ts` reçoit le message sur la socket ; `protocol.ts` le lit, et ne rend que les rachats
   encore en attente.
3. `handler.ts` retrouve l'action de la récompense (`rewards.ts`). Pour une couleur — de la palette,
   tirée au hasard, ou lue dans le texte par `viewer-color.ts` —, `service.ts` arrête d'abord un
   scénario en cours sur les lampes (sa prochaine image repeindrait la couleur), puis la pose. Pour un
   scénario, il le lance pour la durée payée. Le rachat est alors **validé**. Si le texte est
   illisible ou trop sombre, si les ampoules ne répondent pas, ou si les viewers sont en pause, il
   est **remboursé**.

**Un viewer ne perd pas ses points pour rien.** C'est l'invariant du module. Seule une couleur
réellement appliquée, ou un scénario réellement lancé, est validé. La clôture est retentée deux fois sur une panne passagère
(réseau, limitation). Si Twitch la refuse malgré tout, le panneau le dit en distinguant deux cas :
`unsettled` (la couleur est posée, la validation a échoué) et `refund-failed` (la couleur n'est
**pas** posée et le viewer est toujours débité). Dans les deux cas, le streamer règle ce rachat à la
main dans son tableau de bord.

**Ce qui arrive pendant une coupure.** La récompense reste active chez Twitch quand le plugin est
fermé ou déconnecté, et EventSub ne rejoue rien : un rachat fait à ce moment reste « en attente »,
points retenus. À chaque abonnement, `service.ts` liste donc les rachats en attente et **rembourse**
ceux que le plugin n'a pas vus et qui ont plus d'une minute (plus récents, ils sont peut-être en cours
de traitement). La garantie est donc « remboursé au plus tard au prochain démarrage », pas « jamais
débité pendant une panne ». Limite connue : la file des rachats n'a pas de plafond de longueur, et des
ampoules éteintes ou injoignables font attendre les viewers suivants.

**Le texte d'un viewer est une entrée non fiable.** `viewer-color.ts` n'accepte qu'un seul mot
connu (français, anglais, allemand, espagnol ou italien) ou un `#` suivi de 3 ou 6 chiffres hexadécimaux. « rouge vif » est refusé
plutôt que ramené à « rouge », un hexadécimal sans `#` aussi (« facade » est un mot). Le noir et les
quasi-noirs sont refusés : pour une ampoule, un noir est un interrupteur, et un viewer n'éteint pas
la pièce pour le prix d'un rachat. La longueur est contrôlée avant toute autre analyse. Le texte de la
récompense est posté sur Twitch dans la langue de Stream Deck : **chaque exemple qu'il cite doit être
accepté** dans cette langue, un test relit les textes réels pour le garantir.

**Pourquoi le plugin crée les récompenses lui-même.** Twitch ne laisse clore ou rembourser un rachat
qu'à l'application qui a créé la récompense. Une récompense faite à la main dans le tableau de bord
ne pourrait jamais être remboursée. Le plugin les crée donc lui-même (délai de 30 s entre deux
rachats, prix par défaut de 100 à 300 points) ; prix et délai se changent ensuite dans le tableau de
bord Twitch. Il ne touche jamais aux récompenses qu'il n'a pas créées : un titre déjà pris par l'une
d'elles est signalé (`duplicate`), les autres récompenses fonctionnent quand même.

**La session.** L'application est **publique** (flux « Device Code », aucun secret embarqué) : le
Client ID de `auth.ts` identifie l'application et n'ouvre rien. Les jetons vivent dans les réglages
globaux, au même niveau de confiance que les clés locales : jamais journalisés, jamais renvoyés au
panneau — `Status` est le seul type qui franchit cette frontière. Le jeton de renouvellement est à
usage unique : `service.ts` n'en lance qu'un à la fois et l'écrit **avant** de s'en servir. Seul un
jeton **invalide** (400, 401) force à se reconnecter ; une limitation ou une panne de Twitch est
passagère et ne détruit jamais la session. Se déconnecter supprime la récompense et révoque
l'autorisation chez Twitch ; remplacer une session révoque l'ancienne.

**Une liaison qui ne meurt pas en silence.** Twitch envoie un message au moins toutes les dix
secondes. Sans lui, la liaison est déclarée morte et rouverte (délai de 1 à 60 s, remis à zéro après
une connexion réussie) : sans ce chien de garde, les viewers paieraient dans le vide. Une demande de
reconnexion de Twitch ouvre la nouvelle socket **avant** de fermer l'ancienne. Un jeton refusé ou une
révocation arrêtent la boucle : réessayer ne servirait à rien tant que le streamer n'a pas réautorisé.

**Le plugin écoute dès son démarrage**, qu'une touche Twitch soit affichée ou non : une touche sur
une page cachée n'émet aucun événement. Les ampoules visées et l'état de pause sont donc conservés.
Aucune écriture n'a lieu avant la fin de `init`, et chaque écriture part de la valeur **du disque** :
une touche affichée dès le lancement ne peut pas écraser la session persistée. Une « époque » numérote
chaque mise en ligne : une attente réseau qui revient après une déconnexion abandonne, sans laisser de
socket orpheline.

## Langues

Le plugin est écrit **en anglais** et traduit dans les huit langues que Stream Deck connaît —
allemand, espagnol, français, japonais, coréen, chinois simplifié et traditionnel — plus l'italien.
Les dictionnaires sont générés par `tools/make_locales.py` : jamais édités à la main, pour la même
raison que les PNG. Neuf fichiers parallèles divergent dès la première correction, et l'écart ne se
voit qu'en changeant la langue de Stream Deck ; ici, une entrée incomplète **fait échouer** la
génération.

Les textes affichés portent leurs **diacritiques** (« Clé locale », « Weißabgleich », « Cálido »).
La règle d'ASCII du projet vaut pour les commentaires de code, pas pour ce que lit l'utilisateur.

**Deux espaces de noms**, parce que deux consommateurs différents lisent ces fichiers :

| Espace | Consommateur | Forme de la clé |
|---|---|---|
| Plat | Stream Deck, pour le **manifeste** | la chaîne anglaise elle-même, ponctuation comprise |
| Arborescent | le plugin (`streamDeck.i18n`) et les panneaux | chemin pointé : `key.off`, `scenario.orage.name` |

Le manifeste n'a pas le choix : Stream Deck y cherche la chaîne anglaise telle quelle. Partout
ailleurs on préfère une clé structurée, qu'une retouche de style ne casse pas.

**La langue de Stream Deck fait foi**, pas celle du panneau. Relevé en conditions réelles : le
webview annonçait `en` alors que l'application tournait en français. Le plugin sert donc lui-même le
dictionnaire, et l'indice envoyé par le panneau ne sert qu'à l'italien — la seule langue que Stream
Deck ne sait pas exprimer.

**Trois surfaces, trois mécanismes.** Le manifeste est localisé par Stream Deck lui-même. Les mots
dessinés sur les touches passent par `src/i18n.ts` — et arrivent **déjà traduits** dans `key-art.ts`,
qui reste ainsi pur et testable sans dictionnaire. Les panneaux sont écrits en anglais dans le HTML
et localisés à l'affichage par `ui/bulbs.js`, qui remplace les éléments portant `data-i18n`,
`data-i18n-label` ou `data-i18n-placeholder`. Si le dictionnaire ne se charge pas, l'anglais du HTML
reste affiché : jamais de clés nues à l'écran.

**L'italien est un cas particulier.** Stream Deck ne connaît que huit langues — `de, en, es, fr, ja,
ko, zh_CN, zh_TW`. `it.json` n'est donc lu que par les **panneaux**, qui se calent sur la langue du
système via `navigator.language`. Les noms d'actions et les mots sur les touches, eux, suivent la
langue de Stream Deck et resteront en anglais tant qu'Elgato n'ajoutera pas l'italien.

**Le chinois ne se déduit pas d'un préfixe.** Le navigateur annonce tantôt la région (`zh-TW`,
`zh-HK`), tantôt le système d'écriture (`zh-Hant`), tantôt `zh` tout court. La détection des
panneaux teste donc l'écriture avant de retomber sur le simplifié — convention reprise de
sdpi-components, pour que les deux moteurs choisissent le même fichier.

## Compatibilité matérielle

Rien dans le code n'est spécifique à Calex : cette marque appose son nom sur du matériel Tuya, comme
des centaines d'autres. Le critère qui décide est le protocole, pas la marque — **si l'ampoule se
configure dans l'application Smart Life ou Tuya Smart, elle relève de ce pilote**. Cela couvre
notamment Lidl (Livarno Home, Silvercrest), Action (LSC Smart Connect), Nedis, Gosund, Teckin,
Treatlife, BlitzWolf, Woox, Moes.

Deux conditions réelles subsistent :

1. L'ampoule expose le profil d'éclairage habituel (datapoints 20 à 24), ce qui est le cas de
   pratiquement toutes les ampoules blanc + couleur.
2. Sa **version de protocole** est connue. Elle figure dans l'annonce UDP que l'ampoule diffuse
   d'elle-même ; la découverte la relève, le registre la conserve, le pilote la transmet à `tuyapi`.
   Une ampoule déclarée à la main, sans passer par la recherche réseau, retombe sur **3.3** — de très
   loin la plus répandue, mais les modèles vendus depuis 2022 parlent souvent 3.4 ou 3.5.

Ce qui **ne relève pas** de ce pilote et demanderait un adaptateur distinct : Philips Hue et IKEA
Trådfri (Zigbee via pont), LIFX, WiZ, Yeelight, Nanoleaf, Shelly, Govee. C'est précisément ce que le
contrat `LightDriver` rend possible sans toucher aux actions.

**Ce que la lampe sait faire est relevé, pas supposé.** À la connexion, le pilote lit sa table de
datapoints et en déduit ses `capabilities` : une ampoule blanche seule n'expose pas le datapoint 24,
et les actions Couleur et Température l'écrivent sur la touche au lieu d'échouer sans un mot.

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
2. **`Brightness.onKeyDown`** lit le pas dans les réglages (10 par défaut). Sans ampoule joignable
   (liste vide ou clé absente), la touche affiche « À régler » et s'arrête là.
3. **`coordinatesForMany()`** transforme les réglages en une liste de `{ id, key, ip }`, dans l'ordre
   des ampoules cochées. L'adresse est facultative : absente, l'ampoule sera cherchée par diffusion UDP.
4. **`applyToAll`** lance l'opération sur **chaque** ampoule en parallèle, chacune par **`withRetry`**,
   qui demande la connexion au réservoir. Si aucune n'existe pour cette ampoule, elle est
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

## Plusieurs ampoules par touche

Une touche désigne une **liste** d'ampoules (`deviceIds`, cases à cocher dans le panneau). Les
touches posées avant les listes gardent leur lampe : `selectedIds` lit encore `deviceId` et
`deviceId2`, et `adoptGroup` les recopie dans la liste au premier affichage — sans cela le
panneau montrerait une liste vide alors que la touche fonctionne.

Règles de comportement, choisies pour ce qu'une personne attend devant une pièce à plusieurs lampes :

| Geste | Sur un groupe |
|---|---|
| Allumer / éteindre | Une lampe allumée suffit à **éteindre tout le groupe** ; tout éteint, on **allume tout**. Inverser chaque lampe échangerait les allumées et les éteintes. |
| Couleur, blanc | La même valeur pour toutes. Les lampes sans couleur (ou sans blanc réglable) sont laissées telles quelles ; le mot « Sans couleur » n'apparaît que si **aucune** ne sait. |
| Intensité, molette | Chaque lampe bouge de **son propre** niveau, du même pas : aligner sur la première écraserait les réglages lampe par lampe. |
| Scénario | L'ordre des ampoules se règle par flèches dans le panneau. Par défaut, chaque lampe joue le scénario dans son coin (seul le gyrophare répartit deux rôles). Avec « les ampoules jouent ensemble », le scénario est joué **pour la pièce** et cet ordre est le sens dans lequel la lumière se déplace. |

**Panne partielle.** Les lampes obéissent en parallèle et indépendamment : une lampe débranchée
n'empêche pas les autres. Un **appui** est strict — la touche alerte et écrit un mot, le journal
nomme chaque lampe fautive. Une **relecture** est tolérante : la touche se dessine d'après les lampes
qui répondent et ne se déclare en panne que si plus aucune ne répond ; sinon une lampe débranchée à
demeure laisserait « Hors ligne » sur une touche qui marche. Elle n'attend pas non plus la lampe
muette : une seconde après la première réponse, les retardataires sont laissés de côté (le délai de
connexion d'une lampe débranchée est de ~5 s). Dans un **scénario**, une lampe morte ne coupe pas
l'animation des autres ; elle ne s'arrête que si **aucune** lampe ne répond trois images de suite.

**Face de la touche.** Elle montre la **première lampe qui répond** ; « allumé » signifie « au moins une
lampe allumée », ce que son appui éteindrait.

**Scénarios.** Le moteur indexe une session sous **chacune** de ses ampoules (`sessions.ts`). Lancer un
scénario sur un groupe arrête d'abord ce qui occupe l'une quelconque de ses lampes, puis **s'inscrit
aussitôt** — avant le relevé d'état, dont la lecture d'une lampe débranchée dure ~5 s : sinon un second
appui lancerait une seconde session que plus rien ne saurait arrêter. L'arrêt se fait **par identité de
session**, pas par ampoule. Un appui n'arrête un scénario que si c'est **le sien** qui tourne ; sinon il
lance le sien et prend la place de celui d'une touche voisine.

**Migration d'une ancienne touche.** `adoptBulbs` recopie d'abord la clé locale au registre, **puis**
retire `deviceId` des réglages : dans l'autre sens, une interruption laisserait une clé orpheline.

## Ce que l'utilisateur voit quand ça casse

Une panne traverse trois étages, chacun avec une responsabilité unique.

| Étage | Responsabilité |
|---|---|
| `driver/tuya.ts` | Absorbe l'événement `'error'` du device, **qualifie** l'échec et le lève. |
| `driver/pool.ts` | Rejoue une fois **si la cause est réparable par une reconnexion**, puis remonte la cause la plus précise. |
| `actions/failure.ts` | Journalise une fois, écrit un mot sur la touche. **Seul étage qui journalise.** |

### Les quatre causes

| Cause | Signature `tuyapi` | Touche | Ce que l'utilisateur peut faire |
|---|---|---|---|
| `badKey` | `Decrypt failed`, `HMAC mismatch`, `CRC mismatch` — **ou**, en 3.3, une charge utile rendue en clair (voir ci-dessous) | « Clé refusée » | **Rouvrir le panneau** et refaire un scan de QR code. |
| `unreachable` | `find() timed out`, `connection timed out`, `Error from socket`, codes `ECONN*`/`EHOST*` | « Hors ligne » | Vérifier l'alimentation et le réseau ; `npm run diagnose`. |
| `unresponsive` | `Timeout waiting for status response` | « Erreur » | Attendre : le réseau va bien, l'ampoule non. |
| `unknown` | tout le reste | « Erreur » | Lire le journal. |

La reprise de `withRetry` dépend de cette même colonne : `badKey` et `unreachable` ne sont **pas**
rejouées, puisqu'une session neuve n'y change rien — le délai de connexion de `tuyapi` étant de cinq
secondes, les rejouer faisait patienter dix secondes devant une touche muette. `unresponsive` et
`unknown` le sont, la première décrivant exactement ce qu'une session neuve répare.

`badKey` est la seule qui se distingue à l'écran, parce que c'est la seule que l'utilisateur répare
seul. Trois mots pour quatre causes : multiplier les libellés ferait deviner une nuance qui ne
change rien au geste à faire.

Le classement s'appuie sur les **messages** de `tuyapi`, faute de code d'erreur ou de classe typée
dans la bibliothèque. Le prix est connu et assumé : un message reformulé en amont fait retomber le
cas dans `unknown` — un repli sûr, jamais un mauvais diagnostic. `errors.test.mjs` cite les lignes
d'origine pour que la vérification reste mécanique.

### Quand la clé se révèle fausse dépend du protocole

En **3.4 et 3.5**, la clé sert à négocier une session : `connect()` échoue directement, sur un
`HMAC mismatch(keys)`. En **3.3** — de loin la plus répandue — `connect()` n'ouvre qu'un socket TCP,
et la clé ne sert qu'à chiffrer les charges utiles. Une clé fausse ne se voit alors qu'à la première
opération, et `tuyapi` **ne lève rien et n'émet rien** : il rend la charge utile non déchiffrée, sous
forme de *chaîne* là où un objet est attendu.

`readDps()` reconnaît cette signature et lève un `badKey`. Sans elle, le cas le plus courant — une
clé régénérée depuis l'application Calex — s'afficherait « Erreur », et l'utilisateur n'aurait aucune
raison d'aller la ressaisir. Aucun test unitaire ne peut révéler cette nuance : elle tient au
comportement d'une bibliothèque tierce face à du vrai matériel, et seul `live.integration.mjs` §5
la vérifie.

### Une touche en panne se répare toute seule

Les actions sont purement événementielles : `onWillAppear`, un réglage, un geste. **Aucune minuterie
n'interroge l'ampoule de son propre chef**, et c'est voulu — une ampoule Tuya n'accepte qu'une
poignée de connexions simultanées, qu'un sondage général gaspillerait à confirmer que tout va bien.

Conséquence, sans traitement : une touche ayant affiché « Hors ligne » gardait ce mot longtemps après
le retour du courant. C'est le défaut que condamne l'en-tête de `toggle.ts` — *une touche qui ment
est pire qu'une touche sans état* — simplement pris à l'envers.

`recovery.ts` corrige cela sans rien sonder : **seule une touche en échec** se replanifie une
relecture, à 15 s, 30 s, 60 s puis 5 min, la dernière valeur se rejouant indéfiniment. Le cycle
s'éteint dès qu'une relecture n'a plus rien à signaler, et `onWillDisappear` l'annule — inutile de
repeindre un écran que personne ne regarde.

Deux propriétés qui ne se devinent pas à la lecture :

- **Le succès est déduit, pas déclaré.** Chaque échec incrémente un compteur ; une relecture qui se
  termine sans l'avoir incrémenté a forcément réussi. Les chemins nominaux des cinq actions n'ont
  donc pas une ligne à ajouter — ce qui supprime la classe de bugs où l'on oublie de clore le cycle
  dans l'une d'elles.
- **`recover` est toujours une relecture, jamais la commande qui a échoué.** Rejouer un allumage à
  l'insu de l'utilisateur ferait s'animer une lampe plusieurs minutes après son geste. C'est aussi
  ce qui fait que la reprise ne fait jamais clignoter la touche : le report d'une relecture ne
  demande pas d'alerte.

### L'écouteur `'error'`, non négociable

`TuyaDevice` étend `EventEmitter` et émet `'error'` à neuf endroits. Node relance en **exception non
capturée** tout événement `'error'` sans écouteur : sans lui, un `ECONNRESET` — une coupure wifi
suffit — tue le processus du plugin, toutes les touches cessent de répondre, et rien à l'écran ne
l'explique. L'écouteur est posé avant la moindre opération et n'est **jamais** retiré, pas même à la
fermeture : détruire le socket peut encore émettre au tick suivant.

### Journalisation

`WARN` pour les pannes nommées — une ampoule qu'on débranche le soir est un événement domestique
ordinaire. `ERROR` pour `unknown` seul, la seule catégorie qui réclame une lecture humaine. Les
journaux vivent dans `com.lumendeck.bulb.sdPlugin/logs/`.

On journalise la cause et un identifiant **abrégé**, jamais les réglages d'une touche : la clé
locale y figure. Les messages de `tuyapi` sont sûrs à ce titre — ils citent des HMAC dérivés et des
fragments de trame chiffrée, pas le secret.

## Règles de couplage

| Depuis | Peut importer | Ne doit jamais importer |
|---|---|---|
| `src/actions/` | `driver/types`, `driver/pool`, `bulbs`, `settings`, `color-format`, et entre elles `group`, `run`, `power`, `failure`, `recovery`, `face` (les modules transverses — jamais une autre **action**) ; `actions/twitch.ts` seul importe `twitch/service` | `driver/tuya`, `tuyapi`, une autre action |
| `src/bulbs.ts` | `globals`, `registry`, `actions/group` (modules purs) | `driver/*`, toute autre partie de `actions/` |
| `src/globals.ts` | `@elgato/streamdeck` (réglages globaux), `global-store` | tout le reste — c'est le point d'accès unique |
| `src/global-store.ts`, `src/registry.ts` | **rien** | tout — modules purs, testés sans SDK |
| `src/twitch/` (sauf `service.ts`) | `twitch/*` entre eux, `color-format`, `driver/types` (types) | `@elgato/streamdeck`, `actions/`, `bulbs`, `driver/pool` — ils restent purs et testables |
| `src/twitch/service.ts` | `twitch/*`, `bulbs`, `globals`, `driver/pool`, `scenarios/runner`, `actions/group` | `driver/tuya`, `tuyapi` |
| `src/discovery.ts` | `node:dgram`, `node:crypto` | tout le reste — il n'écoute que le réseau |
| `src/key-art.ts` | **rien** | tout — c'est un module de dessin pur |
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
- ❌ Laisser un `catch {}` nu dans une action. Une panne avalée est une panne que personne ne
  saura diagnostiquer — passer par `reportFailure()`.
- ❌ Construire un `TuyAPI` sans lui poser un écouteur `'error'` : le processus meurt au premier
  incident de socket.
- ❌ Journaliser deux fois la même panne. Le report au niveau de l'action est le seul étage qui
  écrit ; un pilote ou un réservoir qui journalise dédouble les lignes et brouille la lecture.
- ❌ Utiliser une propriété de paramètre TypeScript : cela casse l'exécution directe par Node, donc
  le test matériel sans build.
- ❌ Ajouter un import relatif **de valeur** suffixé `.js` dans un module atteint directement par
  les tests. Node ne réécrit pas `.js` en `.ts` : le module devient introuvable et le test casse.
  Suffixer `.ts` (voir « Stratégie de test »).
- ❌ Appliquer le texte d'un viewer sans passer par `parseViewerColor`, ou lui faire payer un rachat
  non appliqué : tout rachat qui n'aboutit pas est remboursé.
- ❌ Appeler `setGlobalSettings` directement, ou lire puis écrire les réglages globaux en deux temps.
  Il **remplace** l'objet entier : le registre d'ampoules ou la session Twitch disparaîtrait sans
  erreur. Passer par `updateGlobal` (`globals.ts`), qui calcule la nouvelle valeur DANS la file.
- ❌ Renouveler un jeton Twitch sans l'écrire avant de s'en servir, ou en lancer deux à la fois : le
  jeton de renouvellement n'est valable qu'une fois, le second échec invalide toute la session.
- ❌ Citer le texte d'une réponse Twitch dans un message d'erreur ou le journal : il peut contenir
  un jeton. Les erreurs portent un code et un message fixes.
- ❌ Retoucher un PNG à la main plutôt que `tools/make_icons.py`.
- ❌ Arrondir un PNG de touche : Stream Deck arrondit lui-même, on obtient des coins morts.
- ❌ Passer un SVG **nu** à `setImage`. Toujours l'emballer avec `asImage()`, qui produit un
  data-URI encodé. Un dessin de touche est truffé de couleurs `#rrggbb` ; dans une URI, le premier
  `#` ouvre le fragment et tout ce qui suit est jeté. Envoyée nue, l'image arrive tronquée dès sa
  première couleur — **en silence** : pas d'erreur, pas de journal, la touche garde simplement son
  image précédente et paraît figée.
- ❌ Écrire `rgba()`, `hsl()` ou une variable CSS dans un SVG de touche. Le moteur SVG de Stream
  Deck est aligné sur CSS2 et ne connaît que `rgb()`. N'employer que `#rrggbb` et `*-opacity`.

## Stratégie de test

Deux étages, séparés parce qu'ils n'ont pas les mêmes prérequis.

**Tests purs** — `src/driver/__tests__/*.test.mjs`, lancés par `npm test`. Ils couvrent les
calculs où une erreur d'un facteur dix passe inaperçue à l'œil : encodage et décodage des couleurs,
allers-retours d'échelle, plancher matériel, bornes de température. `errors.test.mjs` y ajoute le
classement des pannes, sur les messages réels de `tuyapi`. Aucune ampoule requise, donc exécutables
partout. Les modules Twitch se testent sans compte ni réseau (`twitch-*.test.mjs`, `viewer-color`) :
réseau, horloge, socket et attente y sont des faux injectés. `service.ts`, la colle liée au SDK, n'a
pas de test direct ; ses décisions d'état sont extraites dans `state.ts` et `face.ts`, qui en ont.

Ces tests importent les **sources** avec un suffixe `.ts` et Node les exécute sans build, par
effacement de types. D'où deux contraintes sur tout module qu'un test atteint : aucune syntaxe
TypeScript non effaçable (ni `enum`, ni propriété de paramètre), et tout import relatif **de valeur**
suffixé `.ts` — Node ne réécrit pas `.js` en `.ts`. `rewriteRelativeImportExtensions` (tsconfig)
rétablit l'extension `.js` à la compilation, si bien que le bundle reste correct.

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

## Montrer plutôt qu'écrire

Stream Deck dessine le titre d'une action **par-dessus** l'image de la touche. Un glyphe centré et un
texte centré se percutent, et c'est ce qui rendait les premières versions illisibles.

Deux réponses, selon ce qu'il y a à dire. Pour l'allumage, **deux images** déclarées au manifeste :
ampoule grise éteinte, ambre allumée, et aucun titre — `setState()` bascule de l'une à l'autre. Pour
les valeurs, l'image est **dessinée à la volée** en SVG et envoyée par `setImage()` : une jauge qui
se remplit à proportion, une goutte remplie de la couleur réellement appliquée, un demi-disque teinté
à la vraie température du blanc. Le nombre est dessiné *dans* l'image, à un endroit choisi.

Stream Deck accepte une chaîne SVG telle quelle — aucune rasterisation, donc aucune dépendance
graphique dans un plugin qui n'en avait pas besoin, et un rendu net à toutes les tailles.

Une molette n'ayant pas d'états, elle conserve le texte et l'écran du Stream Deck+.

Le dessin se rafraîchit aussi sur `onDidReceiveSettings`, c'est-à-dire dès qu'un réglage change dans
le panneau. Deux comportements distincts s'y jouent. Pour l'allumage et l'intensité, on **relit
l'ampoule** : un réglage modifié peut désigner une autre lampe, et garder l'affichage précédent
reviendrait à parler de la mauvaise. Pour la couleur et la température, on **n'interroge rien** et on
peint la valeur choisie : l'utilisateur est en train de la sélectionner, il veut la voir pendant
qu'il la choisit. L'aperçu reste fidèle, puisque appuyer allume l'ampoule et applique exactement
cette valeur.

La même question se repose **à l'apparition** d'une touche, et la réponse dépend cette fois du
contrôleur. Sur une **touche**, la goutte et le demi-disque montrent *leur propre* valeur, celle que
l'appui appliquera : deux touches pointant la même ampoule doivent rester distinguables, sinon on ne
sait plus laquelle fait quoi — et le doute naît précisément après en avoir pressé une, puisque les
deux se mettent alors à afficher la même chose. Sur une **molette**, l'écran suit la lampe : la
rotation part de sa valeur courante, et la contredire priverait le geste de sens. L'état allumé /
éteint, lui, vient toujours de la lampe dans les deux cas — c'est lui qui assombrit le dessin.

Cette règle vit dans `src/actions/face.ts`, seule et sans dépendance, plutôt qu'en double au fond de
`color.ts` et de `temperature.ts` : c'est ce qui la rend vérifiable, et le test porte le cas qui l'a
révélée — une lampe verte, deux touches, dont une réglée sur violet.

## Le registre des ampoules

Les identifiants ne vivent pas dans les touches mais dans les **réglages globaux** du plugin (clé
`bulbs`, à côté de `twitch` : voir `globals.ts`). Une
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

Six actions couvrent l'allumage, l'intensité, la couleur, le blanc réglable, les scénarios animés
et le tableau de bord Twitch. Côté Twitch, les scénarios qui clignotent sont signalés dans le panneau
mais restent autorisés : c'est le choix du streamer, le plafond de deux alternances par seconde
(`MIN_HOLD_MS`) s'appliquant de toute façon. Restent hors du périmètre : les **scènes internes de l'ampoule** (datapoint 25, non
exploité — nos scénarios sont pilotés depuis le plugin, image par image) et tout **adaptateur autre
que Tuya**.

Une contrainte matérielle à connaître plutôt qu'un manque : couleur et température **s'excluent
mutuellement**. Écrire une température fait quitter le mode couleur, et c'est l'ampoule qui
l'impose, pas le plugin.
