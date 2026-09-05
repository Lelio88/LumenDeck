"""Genere les dictionnaires de traduction du plugin.

Ce que fait ce script : ecrire `<langue>.json` a la racine du dossier plugin, a
partir d'une table unique ou chaque texte figure dans toutes les langues, cote a
cote.

Choix non evident, et raison d'etre du script : cinq fichiers JSON ecrits a la
main divergent des la premiere correction — on traduit, on oublie une langue, et
l'ecart ne se voit jamais parce qu'il faut changer la langue de Stream Deck pour
s'en apercevoir. Ici, une entree incomplete fait echouer la generation.

DEUX ESPACES DE NOMS, parce que deux consommateurs differents lisent ces
fichiers :

  - `PLAT` : Stream Deck localise le MANIFESTE en cherchant la chaine anglaise
    telle quelle dans le dictionnaire. La cle est donc le texte anglais, points
    et ponctuation compris, et doit rester identique au manifeste.

  - `ARBRE` : le plugin (`streamDeck.i18n.translate`) et les panneaux resolvent
    une cle en CHEMIN POINTE (`key.off`). Les points y sont donc structurants,
    ce qui interdit d'y mettre une phrase.

Langues : Stream Deck n'en connait que huit (de, en, es, fr, ja, ko, zh_CN,
zh_TW). L'italien n'en fait pas partie : `it.json` n'est lu que par les panneaux,
qui se calent sur la langue du systeme, jamais par l'application elle-meme.

Usage canonique :
    py -3.11 tools/make_locales.py
"""
import io
import json
import pathlib

LANGUES = ("en", "fr", "de", "es", "it")

ROOT = pathlib.Path(__file__).resolve().parent.parent / "com.lumendeck.bulb.sdPlugin"

# --- Manifeste : la cle EST le texte anglais du manifeste --------------------
PLAT = {
    "Local control of Tuya smart bulbs (Calex Smart and compatible): power, brightness, colour and white balance, without the cloud, in about twenty milliseconds.": {
        "fr": "Pilotage local d'ampoules Tuya (compatibles Calex Smart) : allumage, intensite, couleur et blanc reglable, sans cloud, en une vingtaine de millisecondes.",
        "de": "Lokale Steuerung von Tuya-Lampen (Calex Smart und kompatible): Ein/Aus, Helligkeit, Farbe und Weissabgleich, ohne Cloud, in rund zwanzig Millisekunden.",
        "es": "Control local de bombillas Tuya (Calex Smart y compatibles): encendido, intensidad, color y blanco regulable, sin nube, en unos veinte milisegundos.",
        "it": "Controllo locale di lampadine Tuya (Calex Smart e compatibili): accensione, intensita, colore e bianco regolabile, senza cloud, in circa venti millisecondi.",
    },
    "Power": {"fr": "Allumage", "de": "Ein/Aus", "es": "Encendido", "it": "Accensione"},
    "Brightness": {"fr": "Intensite", "de": "Helligkeit", "es": "Intensidad", "it": "Intensita"},
    "Colour": {"fr": "Couleur", "de": "Farbe", "es": "Color", "it": "Colore"},
    "White": {"fr": "Blanc", "de": "Weiss", "es": "Blanco", "it": "Bianco"},
    "Scenario": {"fr": "Scenario", "de": "Szenario", "es": "Escenario", "it": "Scenario"},
    "Turns the bulb on or off.": {
        "fr": "Allume ou eteint l'ampoule.",
        "de": "Schaltet die Lampe ein oder aus.",
        "es": "Enciende o apaga la bombilla.",
        "it": "Accende o spegne la lampadina.",
    },
    "Adjusts brightness; the dial sweeps continuously.": {
        "fr": "Regle l'intensite ; la molette balaie en continu.",
        "de": "Regelt die Helligkeit; der Drehknopf laeuft stufenlos.",
        "es": "Ajusta la intensidad; el dial recorre de forma continua.",
        "it": "Regola l'intensita; la manopola scorre in modo continuo.",
    },
    "Applies a colour; the dial rotates the hue.": {
        "fr": "Applique une couleur ; la molette fait tourner la teinte.",
        "de": "Setzt eine Farbe; der Drehknopf dreht den Farbton.",
        "es": "Aplica un color; el dial gira el tono.",
        "it": "Applica un colore; la manopola ruota la tonalita.",
    },
    "Sets the white balance, from warm to cool.": {
        "fr": "Regle le blanc, du chaud au froid.",
        "de": "Regelt das Weiss, von warm bis kalt.",
        "es": "Ajusta el blanco, de calido a frio.",
        "it": "Regola il bianco, dal caldo al freddo.",
    },
    "Plays a light animation: blink, police lights, candle, storm...": {
        "fr": "Joue une animation lumineuse : clignotement, gyrophare, bougie, orage...",
        "de": "Spielt eine Lichtanimation: Blinken, Blaulicht, Kerze, Gewitter...",
        "es": "Reproduce una animacion luminosa: parpadeo, luces de policia, vela, tormenta...",
        "it": "Riproduce un'animazione luminosa: lampeggio, lampeggiante, candela, temporale...",
    },
    "Turn on / off": {"fr": "Allumer / eteindre", "de": "Ein / aus", "es": "Encender / apagar", "it": "Accendi / spegni"},
    "Adjust brightness": {"fr": "Regler l'intensite", "de": "Helligkeit regeln", "es": "Ajustar intensidad", "it": "Regola intensita"},
    "Rotate the hue": {"fr": "Faire tourner la teinte", "de": "Farbton drehen", "es": "Girar el tono", "it": "Ruota la tonalita"},
    "Adjust the white": {"fr": "Regler le blanc", "de": "Weiss regeln", "es": "Ajustar el blanco", "it": "Regola il bianco"},
    "Start / stop the scenario": {
        "fr": "Lancer / arreter le scenario",
        "de": "Szenario starten / stoppen",
        "es": "Iniciar / detener el escenario",
        "it": "Avvia / ferma lo scenario",
    },
}

# --- Plugin et panneaux : cles en chemin pointe ------------------------------
ARBRE = {
    # Mots ecrits sur la touche. Les garder COURTS : ils sont rendus a 72 px.
    "key.toSet": {"en": "Set up", "fr": "A regler", "de": "Einrichten", "es": "Configurar", "it": "Imposta"},
    "key.offline": {"en": "Offline", "fr": "Hors ligne", "de": "Offline", "es": "Sin conexion", "it": "Non in linea"},
    "key.on": {"en": "On", "fr": "Allumee", "de": "An", "es": "Encendida", "it": "Accesa"},
    "key.off": {"en": "Off", "fr": "Eteinte", "de": "Aus", "es": "Apagada", "it": "Spenta"},
    "key.noColour": {"en": "No colour", "fr": "Sans couleur", "de": "Keine Farbe", "es": "Sin color", "it": "Senza colore"},
    "key.noWhite": {"en": "No white", "fr": "Sans blanc", "de": "Kein Weiss", "es": "Sin blanco", "it": "Senza bianco"},

    # Qualificatifs de blanc, pour que la molette dise plus qu'un nombre.
    "warmth.warm": {"en": "Warm", "fr": "Chaud", "de": "Warm", "es": "Calido", "it": "Caldo"},
    "warmth.neutral": {"en": "Neutral", "fr": "Neutre", "de": "Neutral", "es": "Neutro", "it": "Neutro"},
    "warmth.cool": {"en": "Cool", "fr": "Froid", "de": "Kalt", "es": "Frio", "it": "Freddo"},
    "warmth.daylight": {"en": "Daylight", "fr": "Lumiere du jour", "de": "Tageslicht", "es": "Luz de dia", "it": "Luce diurna"},

    # Titres affiches sur l'ecran d'une molette Stream Deck+.
    "dial.brightness": {"en": "Brightness", "fr": "Intensite", "de": "Helligkeit", "es": "Intensidad", "it": "Intensita"},
    "dial.colour": {"en": "Colour", "fr": "Couleur", "de": "Farbe", "es": "Color", "it": "Colore"},
    "dial.white": {"en": "White", "fr": "Blanc", "de": "Weiss", "es": "Blanco", "it": "Bianco"},
    "dial.scenario": {"en": "Scenario", "fr": "Scenario", "de": "Szenario", "es": "Escenario", "it": "Scenario"},

    # Noms grossiers de teintes, pour que la molette dise autre chose qu'un nombre.
    "hue.red": {"en": "Red", "fr": "Rouge", "de": "Rot", "es": "Rojo", "it": "Rosso"},
    "hue.orange": {"en": "Orange", "fr": "Orange", "de": "Orange", "es": "Naranja", "it": "Arancione"},
    "hue.yellow": {"en": "Yellow", "fr": "Jaune", "de": "Gelb", "es": "Amarillo", "it": "Giallo"},
    "hue.green": {"en": "Green", "fr": "Vert", "de": "Gruen", "es": "Verde", "it": "Verde"},
    "hue.cyan": {"en": "Cyan", "fr": "Cyan", "de": "Cyan", "es": "Cian", "it": "Ciano"},
    "hue.blue": {"en": "Blue", "fr": "Bleu", "de": "Blau", "es": "Azul", "it": "Blu"},
    "hue.violet": {"en": "Violet", "fr": "Violet", "de": "Violett", "es": "Violeta", "it": "Viola"},
    "hue.pink": {"en": "Pink", "fr": "Rose", "de": "Rosa", "es": "Rosa", "it": "Rosa"},

    # Scenarios. Les identifiants restent en francais : ce sont des cles stables
    # deja enregistrees dans les reglages des utilisateurs, les renommer casserait
    # leurs touches.
    "scenario.clignotement.name": {"en": "Blink", "fr": "Clignotement", "de": "Blinken", "es": "Parpadeo", "it": "Lampeggio"},
    "scenario.clignotement.description": {
        "en": "The bulb switches on and off endlessly. Useful as a timer visible from across the room.",
        "fr": "L'ampoule s'allume et s'eteint sans fin. Utile comme minuteur visible de loin.",
        "de": "Die Lampe schaltet endlos ein und aus. Nuetzlich als von weitem sichtbarer Timer.",
        "es": "La bombilla se enciende y se apaga sin fin. Util como temporizador visible de lejos.",
        "it": "La lampadina si accende e si spegne senza fine. Utile come timer visibile da lontano.",
    },
    "scenario.gyrophare.name": {"en": "Police lights", "fr": "Gyrophare", "de": "Blaulicht", "es": "Luces de policia", "it": "Lampeggiante"},
    "scenario.gyrophare.description": {
        "en": "Alternating red and blue, like a police car. With two bulbs, they answer each other.",
        "fr": "Rouge et bleu alternes, facon voiture de police. Avec deux ampoules, elles se repondent.",
        "de": "Rot und Blau im Wechsel, wie ein Polizeiwagen. Mit zwei Lampen antworten sie einander.",
        "es": "Rojo y azul alternos, como un coche de policia. Con dos bombillas, se responden.",
        "it": "Rosso e blu alternati, come un'auto della polizia. Con due lampadine si rispondono.",
    },
    "scenario.respiration.name": {"en": "Breathe", "fr": "Respiration", "de": "Atmen", "es": "Respiracion", "it": "Respiro"},
    "scenario.respiration.description": {
        "en": "Brightness rises and falls slowly, keeping the colour in place. Calm, for working.",
        "fr": "L'intensite monte et descend lentement, en gardant la couleur en place. Calme, pour travailler.",
        "de": "Die Helligkeit steigt und faellt langsam, die Farbe bleibt. Ruhig, zum Arbeiten.",
        "es": "La intensidad sube y baja lentamente, manteniendo el color. Tranquilo, para trabajar.",
        "it": "L'intensita sale e scende lentamente, mantenendo il colore. Calmo, per lavorare.",
    },
    "scenario.bougie.name": {"en": "Candle", "fr": "Bougie", "de": "Kerze", "es": "Vela", "it": "Candela"},
    "scenario.bougie.description": {
        "en": "A warm flame that flickers, never twice the same. The prettiest of the set.",
        "fr": "Une flamme chaude qui vacille, jamais deux fois pareil. Le meilleur rendu de la serie.",
        "de": "Eine warme Flamme, die flackert, nie zweimal gleich. Der schoenste der Reihe.",
        "es": "Una llama calida que titila, nunca dos veces igual. El mejor de la serie.",
        "it": "Una fiamma calda che tremola, mai due volte uguale. Il piu bello della serie.",
    },
    "scenario.orage.name": {"en": "Storm", "fr": "Orage", "de": "Gewitter", "es": "Tormenta", "it": "Temporale"},
    "scenario.orage.description": {
        "en": "A blue gloom, torn by white flashes at irregular intervals.",
        "fr": "Une penombre bleutee, dechiree par des eclairs blancs a intervalles irreguliers.",
        "de": "Ein blaues Halbdunkel, zerrissen von weissen Blitzen in unregelmaessigen Abstaenden.",
        "es": "Una penumbra azulada, rasgada por destellos blancos a intervalos irregulares.",
        "it": "Una penombra bluastra, squarciata da lampi bianchi a intervalli irregolari.",
    },
    "scenario.arc-en-ciel.name": {"en": "Rainbow", "fr": "Arc-en-ciel", "de": "Regenbogen", "es": "Arcoiris", "it": "Arcobaleno"},
    "scenario.arc-en-ciel.description": {
        "en": "The hue turns gently around the whole colour wheel.",
        "fr": "La teinte tourne doucement sur tout le cercle chromatique.",
        "de": "Der Farbton wandert sanft ueber den ganzen Farbkreis.",
        "es": "El tono gira suavemente por todo el circulo cromatico.",
        "it": "La tonalita ruota dolcemente su tutto il cerchio cromatico.",
    },
    "scenario.alerte.name": {"en": "Alert", "fr": "Alerte", "de": "Alarm", "es": "Alerta", "it": "Allerta"},
    "scenario.alerte.description": {
        "en": "Three red flashes, then the lamp returns exactly as it was. To signal an event.",
        "fr": "Trois eclats rouges, puis la lampe revient exactement comme elle etait. Pour signaler un evenement.",
        "de": "Drei rote Blitze, dann kehrt die Lampe genau in ihren Zustand zurueck. Um ein Ereignis zu melden.",
        "es": "Tres destellos rojos, luego la lampara vuelve exactamente a su estado. Para senalar un evento.",
        "it": "Tre lampi rossi, poi la lampada torna esattamente com'era. Per segnalare un evento.",
    },
    "scenario.lever-de-soleil.name": {"en": "Sunrise", "fr": "Lever de soleil", "de": "Sonnenaufgang", "es": "Amanecer", "it": "Alba"},
    "scenario.lever-de-soleil.description": {
        "en": "Five minutes from dark embers to broad daylight. Start it to wake up gently.",
        "fr": "Cinq minutes d'une braise sombre jusqu'au plein jour. A lancer pour se reveiller en douceur.",
        "de": "Fuenf Minuten von dunkler Glut bis zum hellen Tag. Zum sanften Aufwachen.",
        "es": "Cinco minutos de brasa oscura hasta la plena luz del dia. Para despertar suavemente.",
        "it": "Cinque minuti da brace scura a pieno giorno. Da avviare per svegliarsi dolcemente.",
    },

    # --- Panneaux de configuration -----------------------------------------
    "pi.bulb": {"en": "Bulb", "fr": "Ampoule", "de": "Lampe", "es": "Bombilla", "it": "Lampadina"},
    "pi.bulbPlaceholder": {
        "en": "Choose a bulb", "fr": "Choisissez une ampoule", "de": "Lampe waehlen",
        "es": "Elija una bombilla", "it": "Scegli una lampadina",
    },
    "pi.secondBulb": {"en": "Second bulb", "fr": "Seconde ampoule", "de": "Zweite Lampe", "es": "Segunda bombilla", "it": "Seconda lampadina"},
    "pi.secondBulbPlaceholder": {
        "en": "None (optional)", "fr": "Aucune (facultatif)", "de": "Keine (optional)",
        "es": "Ninguna (opcional)", "it": "Nessuna (facoltativa)",
    },
    "pi.scenario": {"en": "Scenario", "fr": "Scenario", "de": "Szenario", "es": "Escenario", "it": "Scenario"},
    "pi.scenarioPlaceholder": {
        "en": "Choose a scenario", "fr": "Choisissez un scenario", "de": "Szenario waehlen",
        "es": "Elija un escenario", "it": "Scegli uno scenario",
    },
    "pi.colour": {"en": "Colour", "fr": "Couleur", "de": "Farbe", "es": "Color", "it": "Colore"},
    "pi.step": {"en": "Step", "fr": "Pas", "de": "Schritt", "es": "Paso", "it": "Passo"},
    "pi.hueStep": {"en": "Hue step", "fr": "Pas de teinte", "de": "Farbton-Schritt", "es": "Paso de tono", "it": "Passo di tonalita"},
    "pi.dialStep": {"en": "Dial step", "fr": "Pas de molette", "de": "Drehknopf-Schritt", "es": "Paso del dial", "it": "Passo manopola"},
    "pi.temperature": {"en": "Temperature", "fr": "Temperature", "de": "Temperatur", "es": "Temperatura", "it": "Temperatura"},

    "pi.manage": {
        "en": "Add or edit a bulb", "fr": "Ajouter ou modifier une ampoule",
        "de": "Lampe hinzufuegen oder bearbeiten", "es": "Anadir o editar una bombilla",
        "it": "Aggiungi o modifica una lampadina",
    },

    "pi.shared.title": {
        "en": "One bulb, many keys", "fr": "Une ampoule, plusieurs touches",
        "de": "Eine Lampe, viele Tasten", "es": "Una bombilla, varias teclas",
        "it": "Una lampadina, piu tasti",
    },
    "pi.shared.body": {
        "en": "Bulbs are declared once for the whole plugin. Every key picks from the same list: no need to retype the key each time, and a changed key is fixed in a single place.",
        "fr": "Les ampoules se declarent une seule fois pour tout le plugin. Toutes vos touches piochent dans la meme liste : inutile de ressaisir la cle a chaque fois, et une cle changee ne se corrige qu'a un seul endroit.",
        "de": "Lampen werden einmal fuer das ganze Plugin angelegt. Alle Tasten greifen auf dieselbe Liste zu: der Schluessel muss nicht jedes Mal neu eingegeben werden, und ein geaenderter Schluessel wird nur an einer Stelle korrigiert.",
        "es": "Las bombillas se declaran una sola vez para todo el plugin. Todas las teclas toman de la misma lista: no hay que reescribir la clave cada vez, y una clave cambiada se corrige en un solo sitio.",
        "it": "Le lampadine si dichiarano una sola volta per tutto il plugin. Tutti i tasti attingono dalla stessa lista: non serve reinserire la chiave ogni volta, e una chiave cambiata si corregge in un solo punto.",
    },

    "pi.stepHelp.title": {
        "en": "What is the step for?", "fr": "A quoi sert le pas ?",
        "de": "Wozu dient der Schritt?", "es": "Para que sirve el paso?", "it": "A cosa serve il passo?",
    },
    "pi.stepHelp.key": {
        "en": "On a key, each press applies this step. A negative value makes a “dim” key: place two side by side, one at +10 and one at -10.",
        "fr": "Sur une touche, chaque appui applique ce pas. Une valeur negative fait une touche « baisser » : posez-en deux cote a cote, l'une a +10 et l'autre a -10.",
        "de": "Auf einer Taste wendet jeder Druck diesen Schritt an. Ein negativer Wert ergibt eine „Dimmen“-Taste: legen Sie zwei nebeneinander, eine mit +10 und eine mit -10.",
        "es": "En una tecla, cada pulsacion aplica este paso. Un valor negativo crea una tecla de «bajar»: coloque dos juntas, una a +10 y otra a -10.",
        "it": "Su un tasto, ogni pressione applica questo passo. Un valore negativo crea un tasto «abbassa»: mettine due affiancati, uno a +10 e uno a -10.",
    },
    "pi.stepHelp.dial": {
        "en": "On a dial, the step is the value of one detent; its sign is ignored, the direction of rotation decides.",
        "fr": "Sur une molette, le pas est la valeur d'un cran ; son signe est ignore, c'est le sens de rotation qui decide.",
        "de": "Am Drehknopf ist der Schritt der Wert einer Raste; das Vorzeichen wird ignoriert, die Drehrichtung entscheidet.",
        "es": "En un dial, el paso es el valor de una muesca; su signo se ignora, decide el sentido de giro.",
        "it": "Su una manopola, il passo e il valore di uno scatto; il segno viene ignorato, decide il senso di rotazione.",
    },

    "pi.tempHelp.title": {
        "en": "Temperature landmarks", "fr": "Reperes de temperature",
        "de": "Temperatur-Orientierung", "es": "Referencias de temperatura", "it": "Riferimenti di temperatura",
    },
    "pi.tempHelp.scale": {
        "en": "2700 K matches an incandescent bulb, very warm. 4000 K is a neutral white. 6500 K is daylight, cool and blue.",
        "fr": "2700 K correspond a une ampoule a incandescence, tres chaude. 4000 K est un blanc neutre. 6500 K est la lumiere du jour, froide et bleutee.",
        "de": "2700 K entspricht einer Gluehlampe, sehr warm. 4000 K ist ein neutrales Weiss. 6500 K ist Tageslicht, kalt und blaeulich.",
        "es": "2700 K corresponde a una bombilla incandescente, muy calida. 4000 K es un blanco neutro. 6500 K es luz de dia, fria y azulada.",
        "it": "2700 K corrisponde a una lampadina a incandescenza, molto calda. 4000 K e un bianco neutro. 6500 K e luce diurna, fredda e bluastra.",
    },
    "pi.tempHelp.mode": {
        "en": "Applying a temperature switches the bulb to white mode, so it leaves colour behind. The bulb imposes this, not the plugin.",
        "fr": "Appliquer une temperature fait passer l'ampoule en mode blanc : elle quitte donc la couleur. C'est l'ampoule qui l'impose, pas le plugin.",
        "de": "Eine Temperatur zu setzen schaltet die Lampe in den Weissmodus, sie verlaesst also die Farbe. Das gibt die Lampe vor, nicht das Plugin.",
        "es": "Aplicar una temperatura pasa la bombilla a modo blanco, por lo que abandona el color. Lo impone la bombilla, no el plugin.",
        "it": "Applicare una temperatura porta la lampadina in modo bianco, quindi abbandona il colore. Lo impone la lampadina, non il plugin.",
    },

    "pi.colourHelp.title": {
        "en": "How do key and dial behave?", "fr": "Comment se comportent touche et molette ?",
        "de": "Wie verhalten sich Taste und Drehknopf?", "es": "Como se comportan tecla y dial?",
        "it": "Come si comportano tasto e manopola?",
    },
    "pi.colourHelp.key": {
        "en": "On a key, one press turns the bulb on and applies exactly the colour chosen above. Place several for your favourite moods.",
        "fr": "Sur une touche, un appui allume l'ampoule et applique exactement la couleur choisie ci-dessus. Posez-en plusieurs pour vos ambiances favorites.",
        "de": "Auf einer Taste schaltet ein Druck die Lampe ein und setzt genau die oben gewaehlte Farbe. Legen Sie mehrere fuer Ihre Lieblingsstimmungen an.",
        "es": "En una tecla, una pulsacion enciende la bombilla y aplica exactamente el color elegido arriba. Ponga varias para sus ambientes favoritos.",
        "it": "Su un tasto, una pressione accende la lampadina e applica esattamente il colore scelto sopra. Mettine diversi per le tue atmosfere preferite.",
    },
    "pi.colourHelp.dial": {
        "en": "On a dial, rotating turns the hue while keeping the bulb's current brightness. Pressing the dial toggles power.",
        "fr": "Sur une molette, la rotation fait tourner la teinte en conservant l'intensite actuelle de l'ampoule. Un appui sur la molette allume ou eteint.",
        "de": "Am Drehknopf dreht die Rotation den Farbton und behaelt die aktuelle Helligkeit bei. Ein Druck schaltet ein oder aus.",
        "es": "En un dial, girar cambia el tono conservando la intensidad actual. Pulsar el dial enciende o apaga.",
        "it": "Su una manopola, la rotazione ruota la tonalita mantenendo l'intensita attuale. Premere accende o spegne.",
    },

    "pi.scenarioHelp.title": {
        "en": "How does it work?", "fr": "Comment ca marche ?", "de": "Wie funktioniert das?",
        "es": "Como funciona?", "it": "Come funziona?",
    },
    "pi.scenarioHelp.toggle": {
        "en": "One press starts the scenario, a second stops it. The lamp then returns exactly to the state it was in: same colour, same brightness, on or off.",
        "fr": "Un appui lance le scenario, un second l'arrete. La lampe revient alors exactement dans l'etat ou elle etait : meme couleur, meme intensite, allumee ou eteinte.",
        "de": "Ein Druck startet das Szenario, ein zweiter stoppt es. Die Lampe kehrt dann genau in ihren vorherigen Zustand zurueck: gleiche Farbe, gleiche Helligkeit, ein oder aus.",
        "es": "Una pulsacion inicia el escenario, otra lo detiene. La lampara vuelve exactamente al estado en que estaba: mismo color, misma intensidad, encendida o apagada.",
        "it": "Una pressione avvia lo scenario, una seconda lo ferma. La lampada torna esattamente allo stato precedente: stesso colore, stessa intensita, accesa o spenta.",
    },
    "pi.scenarioHelp.second": {
        "en": "The second bulb is optional. Only Police lights uses two today, so they answer each other in red and blue. With one, it alternates both colours on the same lamp.",
        "fr": "La seconde ampoule est facultative. Seul le Gyrophare sait aujourd'hui en exploiter deux, pour qu'elles se repondent en rouge et bleu. Avec une seule, il alterne les deux couleurs sur la meme lampe.",
        "de": "Die zweite Lampe ist optional. Nur Blaulicht nutzt heute zwei, damit sie sich in Rot und Blau antworten. Mit einer wechselt es beide Farben auf derselben Lampe.",
        "es": "La segunda bombilla es opcional. Solo Luces de policia usa dos hoy, para que se respondan en rojo y azul. Con una, alterna ambos colores en la misma lampara.",
        "it": "La seconda lampadina e facoltativa. Solo Lampeggiante ne usa due oggi, perche si rispondano in rosso e blu. Con una sola, alterna i due colori sulla stessa lampada.",
    },
    "pi.scenarioHelp.oneShot": {
        "en": "Alert and Sunrise stop on their own, after three flashes and five minutes respectively. The others run until you press again.",
        "fr": "Alerte et Lever de soleil s'arretent tout seuls, apres trois eclats pour le premier et cinq minutes pour le second. Les autres tournent jusqu'a ce que vous appuyiez de nouveau.",
        "de": "Alarm und Sonnenaufgang stoppen von selbst, nach drei Blitzen bzw. fuenf Minuten. Die anderen laufen, bis Sie erneut druecken.",
        "es": "Alerta y Amanecer se detienen solos, tras tres destellos y cinco minutos respectivamente. Los demas siguen hasta que vuelva a pulsar.",
        "it": "Allerta e Alba si fermano da soli, dopo tre lampi e cinque minuti rispettivamente. Gli altri proseguono finche non premi di nuovo.",
    },
    "pi.scenarioHelp.safety": {
        "en": "Animations are deliberately capped at two alternations per second: beyond that, flashing light can trigger a seizure in a photosensitive person.",
        "fr": "Les animations sont volontairement plafonnees a deux alternances par seconde : au-dela, un clignotement peut declencher une crise chez une personne photosensible.",
        "de": "Animationen sind bewusst auf zwei Wechsel pro Sekunde begrenzt: darueber hinaus kann Blinklicht bei photosensiblen Menschen einen Anfall ausloesen.",
        "es": "Las animaciones estan limitadas a proposito a dos alternancias por segundo: mas alla, un parpadeo puede provocar una crisis en una persona fotosensible.",
        "it": "Le animazioni sono volutamente limitate a due alternanze al secondo: oltre, un lampeggio puo scatenare una crisi in una persona fotosensibile.",
    },

    # --- Assistant de recherche d'ampoules ----------------------------------
    "pi.scan.note": {
        "en": "The search first listens for the announcements your bulbs broadcast, then, if nothing arrives, knocks at every address on the network. Allow about twenty seconds in the worst case. It finds address and identifier, but never the key: that one still has to be pasted once per bulb.",
        "fr": "La recherche ecoute d'abord les annonces que vos ampoules diffusent, puis, si rien n'arrive, frappe a chaque adresse du reseau. Comptez une vingtaine de secondes dans le pire cas. Elle trouve adresse et identifiant, mais jamais la cle : celle-ci reste a coller une fois par ampoule.",
        "de": "Die Suche hoert zuerst auf die Ankuendigungen Ihrer Lampen und klopft dann, falls nichts eintrifft, an jede Adresse im Netzwerk. Rechnen Sie im schlimmsten Fall mit rund zwanzig Sekunden. Sie findet Adresse und Kennung, aber nie den Schluessel: den muss man weiterhin einmal pro Lampe einfuegen.",
        "es": "La busqueda escucha primero los anuncios que emiten sus bombillas y luego, si no llega nada, llama a cada direccion de la red. Cuente unos veinte segundos en el peor caso. Encuentra direccion e identificador, pero nunca la clave: esa hay que pegarla una vez por bombilla.",
        "it": "La ricerca ascolta prima gli annunci che le tue lampadine diffondono, poi, se non arriva nulla, bussa a ogni indirizzo della rete. Conta una ventina di secondi nel caso peggiore. Trova indirizzo e identificativo, ma mai la chiave: quella resta da incollare una volta per lampadina.",
    },
    "pi.field.id": {"en": "Bulb identifier", "fr": "Identifiant de l'ampoule", "de": "Lampen-Kennung", "es": "Identificador de la bombilla", "it": "Identificativo della lampadina"},
    "pi.field.name": {
        "en": "Name (optional) — e.g. Desk", "fr": "Nom (facultatif) — ex. Bureau",
        "de": "Name (optional) — z. B. Schreibtisch", "es": "Nombre (opcional) — p. ej. Escritorio",
        "it": "Nome (facoltativo) — es. Scrivania",
    },
    "pi.field.key": {"en": "Local key", "fr": "Cle locale", "de": "Lokaler Schluessel", "es": "Clave local", "it": "Chiave locale"},
    "pi.field.keyKept": {
        "en": "Leave empty to keep the key", "fr": "Cle inchangee si vide",
        "de": "Leer lassen, um den Schluessel zu behalten", "es": "Dejar vacio para conservar la clave",
        "it": "Lascia vuoto per mantenere la chiave",
    },
    "pi.found.already": {"en": "already saved", "fr": "deja enregistree", "de": "bereits gespeichert", "es": "ya guardada", "it": "gia salvata"},
    "pi.found.device": {"en": "Tuya device at", "fr": "Appareil Tuya a", "de": "Tuya-Geraet an", "es": "Dispositivo Tuya en", "it": "Dispositivo Tuya a"},
    "pi.found.noId": {"en": "unknown identifier", "fr": "identifiant inconnu", "de": "Kennung unbekannt", "es": "identificador desconocido", "it": "identificativo sconosciuto"},
    "pi.save.button": {"en": "Save", "fr": "Enregistrer", "de": "Speichern", "es": "Guardar", "it": "Salva"},
    "pi.save.missingId": {
        "en": "This bulb's identifier is missing.", "fr": "Il manque l'identifiant de cette ampoule.",
        "de": "Die Kennung dieser Lampe fehlt.", "es": "Falta el identificador de esta bombilla.",
        "it": "Manca l'identificativo di questa lampadina.",
    },
    "pi.scan.button": {"en": "Search the network", "fr": "Chercher sur le reseau", "de": "Netzwerk durchsuchen", "es": "Buscar en la red", "it": "Cerca nella rete"},
    "pi.scan.running": {"en": "Searching...", "fr": "Recherche en cours...", "de": "Suche laeuft...", "es": "Buscando...", "it": "Ricerca in corso..."},
    "pi.scan.none": {
        "en": "No device found. Check that the bulb is powered and on the same network as this computer.",
        "fr": "Aucun appareil trouve. Verifiez que l'ampoule est alimentee et sur le meme reseau que cet ordinateur.",
        "de": "Kein Geraet gefunden. Pruefen Sie, ob die Lampe mit Strom versorgt ist und im selben Netzwerk wie dieser Rechner haengt.",
        "es": "No se encontro ningun dispositivo. Compruebe que la bombilla tiene corriente y esta en la misma red que este ordenador.",
        "it": "Nessun dispositivo trovato. Verifica che la lampadina sia alimentata e sulla stessa rete di questo computer.",
    },
    "pi.scan.found": {"en": "device(s) found", "fr": "appareil(s) trouve(s)", "de": "Geraet(e) gefunden", "es": "dispositivo(s) encontrado(s)", "it": "dispositivo/i trovato/i"},
    "pi.scan.sweep": {
        "en": " (found by sweeping the network: your bulbs do not broadcast this far, which is common between a wired computer and a Wi-Fi bulb)",
        "fr": " (trouve par balayage du reseau : vos ampoules ne diffusent pas jusqu'ici, c'est frequent entre un ordinateur filaire et une ampoule en wifi)",
        "de": " (per Netzwerk-Scan gefunden: Ihre Lampen senden nicht bis hierher, haeufig zwischen einem kabelgebundenen Rechner und einer WLAN-Lampe)",
        "es": " (encontrado por barrido de red: sus bombillas no difunden hasta aqui, algo frecuente entre un ordenador por cable y una bombilla wifi)",
        "it": " (trovato tramite scansione della rete: le tue lampadine non trasmettono fin qui, frequente tra un computer via cavo e una lampadina wifi)",
    },
    "pi.save.ok": {
        "en": "Bulb saved. Choose it in the list above.",
        "fr": "Ampoule enregistree. Choisissez-la dans la liste ci-dessus.",
        "de": "Lampe gespeichert. Waehlen Sie sie in der Liste oben aus.",
        "es": "Bombilla guardada. Eligela en la lista de arriba.",
        "it": "Lampadina salvata. Scegliela nella lista qui sopra.",
    },
    "pi.save.failed": {"en": "Could not save.", "fr": "Echec de l'enregistrement.", "de": "Speichern fehlgeschlagen.", "es": "Error al guardar.", "it": "Salvataggio non riuscito."},
    "pi.save.needKey": {
        "en": "This bulb needs its local key to be controllable.",
        "fr": "Cette ampoule a besoin de sa cle locale pour etre pilotable.",
        "de": "Diese Lampe braucht ihren lokalen Schluessel, um steuerbar zu sein.",
        "es": "Esta bombilla necesita su clave local para poder controlarse.",
        "it": "Questa lampadina ha bisogno della sua chiave locale per essere controllabile.",
    },
}


def nest(flat: dict) -> dict:
    """Transforme des cles pointees en arborescence."""
    tree: dict = {}
    for key, value in flat.items():
        node = tree
        parts = key.split(".")
        for part in parts[:-1]:
            node = node.setdefault(part, {})
        node[parts[-1]] = value
    return tree


def main() -> None:
    print("Dictionnaires LumenDeck")
    for langue in LANGUES:
        plat = {}
        for anglais, versions in PLAT.items():
            # L'anglais est la cle : une entree identite n'apporterait rien.
            if langue != "en":
                if langue not in versions:
                    raise SystemExit("Traduction {} manquante pour : {}".format(langue, anglais[:50]))
                plat[anglais] = versions[langue]

        pointe = {}
        for cle, versions in ARBRE.items():
            if langue not in versions:
                raise SystemExit("Traduction {} manquante pour la cle : {}".format(langue, cle))
            pointe[cle] = versions[langue]

        contenu = dict(plat)
        contenu.update(nest(pointe))

        chemin = ROOT / "{}.json".format(langue)
        with io.open(chemin, "w", encoding="utf-8", newline="\n") as f:
            json.dump({"Localization": contenu}, f, ensure_ascii=False, indent=2)
            f.write("\n")
        print("  {:>3}  {} entrees  {}".format(langue, len(contenu), chemin.name))


if __name__ == "__main__":
    main()
