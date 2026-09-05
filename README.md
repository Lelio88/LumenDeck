# LumenDeck

Pilotez vos ampoules connectées depuis votre Stream Deck. Une touche, et la lumière suit —
instantanément.

## Pourquoi pas simplement l'application du fabricant ?

Parce qu'elle passe par Internet. Chaque « allume la lumière » fait un aller-retour jusqu'à un
serveur à l'autre bout du monde avant que votre ampoule ne bouge : entre un tiers de seconde et une
seconde, parfois plus quand le service rame.

LumenDeck parle **directement à l'ampoule, sur votre réseau**. Le trajet complet prend une vingtaine
de millisecondes — c'est en dessous du seuil où l'œil perçoit un délai. La lumière change *pendant*
que votre doigt appuie, pas après.

Trois conséquences agréables :

- **Ça marche sans Internet.** Box en panne, fibre coupée : vos touches fonctionnent toujours.
- **Rien ne sort de chez vous.** Aucune commande n'est envoyée à un serveur tiers.
- **Aucun compte à garder ouvert.** La configuration se fait une fois, puis on oublie.

## Ce qu'il vous faut

- Un **Stream Deck** (modèle classique ou Stream Deck+)
- Une **ampoule Calex Smart**, ou n'importe quelle ampoule pilotée par les applications
  **Smart Life** ou **Tuya** — c'est la même technologie sous plusieurs marques
- L'ampoule et l'ordinateur sur le **même réseau Wi-Fi**

## Ce que ça sait faire

| | Sur une touche | Sur une molette (Stream Deck+) |
|---|---|---|
| **Allumer / éteindre** | un appui | appui sur la molette |
| **Intensité** | un appui = un palier | rotation continue, niveau affiché à l'écran |
| **Couleur** | applique la couleur choisie | rotation = la teinte défile |
| **Blanc chaud / froid** | applique la température choisie | rotation de 2700 K à 6500 K |

Les touches **montrent** leur état plutôt que de l'écrire : l'ampoule s'allume, la jauge se remplit,
la goutte prend la couleur choisie, le disque se teinte à la vraie chaleur du blanc.

Bon à savoir : couleur et blanc réglable s'excluent — choisir une température fait quitter la
couleur. C'est l'ampoule qui l'impose, pas le plugin.

## Installation

LumenDeck n'est pas encore publié sur le Marketplace Elgato. En attendant, deux commandes depuis ce
dossier :

```bash
npm install
npm run pack
```

Un fichier `dist/com.lumendeck.bulb.streamDeckPlugin` apparaît. **Double-cliquez dessus** : Stream
Deck l'installe. Le dossier du dépôt n'a plus aucune utilité, vous pouvez le supprimer.

Prérequis : **Node 24 ou plus** pour construire, et l'application Stream Deck en **7.1 minimum**.
Node n'est nécessaire qu'à la construction — le plugin, lui, tourne sur le Node embarqué de Stream
Deck.

Une catégorie **LumenDeck** apparaît alors dans Stream Deck avec ses quatre actions, à glisser sur
une touche.

<details>
<summary>Si vous comptez modifier le code</summary>

`npm run deploy` rattache le plugin au dossier du dépôt et le recharge, ce qui évite de réinstaller
après chaque modification. Le plugin dépend alors de ce dossier : ne le déplacez pas. Les deux modes
s'excluent — pour repasser en installation autonome, `npx streamdeck unlink com.lumendeck.bulb`
d'abord.
</details>

## La configuration, une bonne fois pour toutes

Pour parler à votre ampoule sans passer par le cloud, LumenDeck a besoin de deux informations
qu'elle seule détient : son identifiant et sa clé. Elles s'obtiennent en une seule opération, en
scannant un QR code depuis votre application Calex ou Smart Life. Comptez cinq minutes.

Ces informations restent sur votre machine. La clé ne vaut que sur votre réseau : elle ne donne
accès à rien d'autre, et elle se renouvelle si vous ré-appairez l'ampoule.

> Procédure pas à pas : [`docs/configuration.md`](./docs/configuration.md). C'est aujourd'hui
> l'étape la moins agréable du projet, et la rendre indolore est justement ce qui conditionne une
> publication sur le Marketplace.

## Bon à savoir

**Ce projet n'est pas affilié à Calex ni à Tuya.** C'est un projet personnel, qui utilise le
protocole local que ces ampoules exposent déjà sur votre réseau.

Il est jeune : il pilote une ampoule à la fois par touche, et n'a été éprouvé que sur un modèle
(Calex « LED SMART »). Si vous en essayez un autre, le retour est bienvenu.

---

*Développeurs : l'architecture, les contraintes et la façon de contribuer sont décrites dans
[`CLAUDE.md`](./CLAUDE.md) et [`docs/architecture.md`](./docs/architecture.md).*
