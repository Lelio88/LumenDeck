# Récupérer l'identifiant et la clé de votre ampoule

Pour parler à une ampoule sans passer par le cloud, il faut deux informations qu'elle seule détient :
son **identifiant** et sa **clé locale**. La clé est le secret qui chiffre les échanges sur votre
réseau ; elle est créée au moment où vous appairez l'ampoule dans l'application du fabricant.

Comptez cinq minutes. Vous n'aurez à le faire qu'une fois par ampoule.

## Ce dont vous avez besoin

- Votre téléphone, avec l'application **Calex Smart** (ou **Smart Life**, c'est la même chose)
- Python installé sur l'ordinateur

## La méthode

On utilise [`tuya-local-key`](https://github.com/vineetchoudhary/tuya-local-key), un outil qui passe
par le mécanisme officiel de partage d'appareils de Tuya. **Aucun compte développeur n'est
nécessaire** : une connexion par QR code suffit.

### 1. Relevez votre code utilisateur

Dans l'application Calex : **Moi** → **Paramètres** → **Compte et sécurité** → **Code utilisateur**.
C'est une courte suite de caractères. Notez-la.

### 2. Préparez le scanner

Toujours dans l'application, revenez à l'accueil et appuyez sur **+** (en haut à droite) →
**Scanner**. Restez sur cet écran : le QR code n'est valable que deux minutes et demie.

### 3. Lancez l'outil

```bash
git clone https://github.com/vineetchoudhary/tuya-local-key
cd tuya-local-key
python -m venv .venv
.venv/Scripts/python -m pip install -r requirements.txt   # .venv/bin/python sous macOS et Linux
.venv/Scripts/python tuya_devices.py
```

L'outil demande votre code utilisateur, puis affiche un QR code. Scannez-le et confirmez.

> **L'application va vous demander d'autoriser « Home Assistant ».** C'est normal : l'outil emprunte
> l'enregistrement applicatif public de ce projet auprès de Tuya, et c'est précisément ce qui permet
> de se passer d'un compte développeur.

### 4. Récupérez vos informations

L'outil liste vos appareils. Pour chacun, retenez `id` et `local_key` : ce sont les deux champs à
recopier dans le panneau de réglages de la touche LumenDeck.

## Deux pièges à connaître

**L'adresse IP affichée n'est pas la bonne.** L'outil montre l'adresse publique de votre box, telle
que le cloud Tuya la voit — pas celle de l'ampoule sur votre réseau. Celle qu'il vous faut ressemble
à `192.168.x.x`. Vous la trouverez dans l'interface de votre box, ou vous pouvez simplement laisser
le champ vide : LumenDeck cherchera alors l'ampoule par diffusion, ce qui est un peu plus lent au
premier appui.

**Pensez à réserver l'adresse.** Si votre box attribue les adresses dynamiquement, celle de l'ampoule
peut changer au redémarrage et la touche cessera de la trouver. La plupart des box permettent de
figer une adresse pour un appareil donné.

## Si vous devez recommencer

La clé locale est **régénérée à chaque ré-appairage** de l'ampoule. Si vous la réinitialisez ou la
ré-ajoutez dans l'application Calex, reprenez cette procédure : la connexion précédente est
définitivement caduque.

## Où ranger ces informations

La clé ne vaut que sur votre réseau local : elle ne donne accès ni à votre compte, ni à quoi que ce
soit d'autre. Elle reste néanmoins un secret — gardez-la hors de tout dépôt de code.
