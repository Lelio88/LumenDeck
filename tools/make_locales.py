# -*- coding: utf-8 -*-
"""Genere les dictionnaires de traduction du plugin.

Ce que fait ce script : ecrire `<langue>.json` a la racine du dossier plugin, a
partir d'une table unique ou chaque texte figure dans toutes les langues, cote a
cote.

Choix non evident, et raison d'etre du script : neuf fichiers JSON ecrits a la
main divergent des la premiere correction — on traduit, on oublie une langue, et
l'ecart ne se voit jamais parce qu'il faudrait changer la langue de Stream Deck
pour s'en apercevoir. Ici, une entree incomplete fait echouer la generation.

DEUX ESPACES DE NOMS, parce que deux consommateurs differents lisent ces
fichiers :

  - `PLAT` : Stream Deck localise le MANIFESTE en cherchant la chaine anglaise
    telle quelle dans le dictionnaire. La cle est donc le texte anglais, points
    et ponctuation compris, et doit rester identique au manifeste.

  - `ARBRE` : le plugin (`streamDeck.i18n.translate`) et les panneaux resolvent
    une cle en CHEMIN POINTE (`key.off`). Les points y sont donc structurants,
    ce qui interdit d'y mettre une phrase.

ACCENTS : ce sont des textes AFFICHES, pas des commentaires de code. Ils portent
donc leurs diacritiques — « Cle locale » etait une faute, pas une convention. La
regle d'ASCII du projet s'arrete a la frontiere de l'interface.

LANGUES : Stream Deck en connait huit (de, en, es, fr, ja, ko, zh_CN, zh_TW) ;
elles sont toutes couvertes. L'italien s'y ajoute pour les PANNEAUX seulement :
l'application ne le propose pas, mais un panneau est une page web et suit la
langue du systeme.

Longueur : les entrees `key.*` s'affichent sur une touche de 72 px. Les garder
COURTES, quitte a etre telegraphique — c'est la seule contrainte de forme ici.

Usage canonique :
    py -3.11 tools/make_locales.py
"""
import io
import json
import pathlib

# L'anglais d'abord : c'est la langue de reference, les autres en decoulent.
LANGUES = ("en", "fr", "de", "es", "it", "ja", "ko", "zh_CN", "zh_TW")

ROOT = pathlib.Path(__file__).resolve().parent.parent / "com.lumendeck.bulb.sdPlugin"

# --- Manifeste : la cle EST le texte anglais du manifeste --------------------
PLAT = {
    "Local control of Tuya smart bulbs (Calex Smart and compatible): power, brightness, colour and white balance, without the cloud, in about twenty milliseconds.": {
        "fr": "Pilotage local d'ampoules Tuya (compatibles Calex Smart) : allumage, intensité, couleur et blanc réglable, sans cloud, en une vingtaine de millisecondes.",
        "de": "Lokale Steuerung von Tuya-Lampen (Calex Smart und kompatible): Ein/Aus, Helligkeit, Farbe und Weißabgleich, ohne Cloud, in rund zwanzig Millisekunden.",
        "es": "Control local de bombillas Tuya (Calex Smart y compatibles): encendido, intensidad, color y blanco regulable, sin nube, en unos veinte milisegundos.",
        "it": "Controllo locale di lampadine Tuya (Calex Smart e compatibili): accensione, intensità, colore e bianco regolabile, senza cloud, in circa venti millisecondi.",
        "ja": "Tuya スマート電球（Calex Smart 互換）をローカルで制御。電源・明るさ・色・白色温度を、クラウドを介さず約 20 ミリ秒で。",
        "ko": "Tuya 스마트 전구(Calex Smart 호환)를 로컬에서 제어합니다. 전원, 밝기, 색상, 백색 온도를 클라우드 없이 약 20밀리초 만에.",
        "zh_CN": "在本地控制 Tuya 智能灯泡（兼容 Calex Smart）：开关、亮度、颜色和白光色温，无需云端，约二十毫秒。",
        "zh_TW": "在本機控制 Tuya 智慧燈泡（相容 Calex Smart）：開關、亮度、顏色與白光色溫，無需雲端，約二十毫秒。",
    },
    "Power": {
        "fr": "Allumage", "de": "Ein/Aus", "es": "Encendido", "it": "Accensione",
        "ja": "電源", "ko": "전원", "zh_CN": "电源", "zh_TW": "電源",
    },
    "Brightness": {
        "fr": "Intensité", "de": "Helligkeit", "es": "Intensidad", "it": "Intensità",
        "ja": "明るさ", "ko": "밝기", "zh_CN": "亮度", "zh_TW": "亮度",
    },
    "Colour": {
        "fr": "Couleur", "de": "Farbe", "es": "Color", "it": "Colore",
        "ja": "色", "ko": "색상", "zh_CN": "颜色", "zh_TW": "顏色",
    },
    "White": {
        "fr": "Blanc", "de": "Weiß", "es": "Blanco", "it": "Bianco",
        "ja": "白色", "ko": "백색", "zh_CN": "白光", "zh_TW": "白光",
    },
    "Scenario": {
        "fr": "Scénario", "de": "Szenario", "es": "Escenario", "it": "Scenario",
        "ja": "シナリオ", "ko": "시나리오", "zh_CN": "情景", "zh_TW": "情境",
    },
    "Turns the bulb on or off.": {
        "fr": "Allume ou éteint l'ampoule.",
        "de": "Schaltet die Lampe ein oder aus.",
        "es": "Enciende o apaga la bombilla.",
        "it": "Accende o spegne la lampadina.",
        "ja": "電球をオン・オフします。",
        "ko": "전구를 켜거나 끕니다.",
        "zh_CN": "打开或关闭灯泡。",
        "zh_TW": "開啟或關閉燈泡。",
    },
    "Adjusts brightness; the dial sweeps continuously.": {
        "fr": "Règle l'intensité ; la molette balaie en continu.",
        "de": "Regelt die Helligkeit; der Drehknopf läuft stufenlos.",
        "es": "Ajusta la intensidad; el dial recorre de forma continua.",
        "it": "Regola l'intensità; la manopola scorre in modo continuo.",
        "ja": "明るさを調整します。ダイヤルは連続的に変化します。",
        "ko": "밝기를 조절합니다. 다이얼은 연속으로 변합니다.",
        "zh_CN": "调节亮度；旋钮可连续调整。",
        "zh_TW": "調整亮度；旋鈕可連續調整。",
    },
    "Applies a colour; the dial rotates the hue.": {
        "fr": "Applique une couleur ; la molette fait tourner la teinte.",
        "de": "Setzt eine Farbe; der Drehknopf dreht den Farbton.",
        "es": "Aplica un color; el dial gira el tono.",
        "it": "Applica un colore; la manopola ruota la tonalità.",
        "ja": "色を適用します。ダイヤルで色相を回します。",
        "ko": "색상을 적용합니다. 다이얼로 색조를 돌립니다.",
        "zh_CN": "应用颜色；旋钮可转动色相。",
        "zh_TW": "套用顏色；旋鈕可轉動色相。",
    },
    "Sets the white balance, from warm to cool.": {
        "fr": "Règle le blanc, du chaud au froid.",
        "de": "Regelt das Weiß, von warm bis kalt.",
        "es": "Ajusta el blanco, de cálido a frío.",
        "it": "Regola il bianco, dal caldo al freddo.",
        "ja": "白色温度を暖色から寒色まで調整します。",
        "ko": "백색 온도를 따뜻한 색에서 차가운 색까지 조절합니다.",
        "zh_CN": "调节白光色温，从暖色到冷色。",
        "zh_TW": "調整白光色溫，從暖色到冷色。",
    },
    "Plays a light animation: blink, police lights, candle, storm...": {
        "fr": "Joue une animation lumineuse : clignotement, gyrophare, bougie, orage…",
        "de": "Spielt eine Lichtanimation: Blinken, Blaulicht, Kerze, Gewitter…",
        "es": "Reproduce una animación luminosa: parpadeo, luces de policía, vela, tormenta…",
        "it": "Riproduce un'animazione luminosa: lampeggio, lampeggiante, candela, temporale…",
        "ja": "光の演出を再生します。点滅、パトカー、ろうそく、雷雨など。",
        "ko": "조명 연출을 재생합니다. 깜빡임, 경광등, 촛불, 폭풍 등.",
        "zh_CN": "播放灯光动画：闪烁、警灯、烛光、雷雨……",
        "zh_TW": "播放燈光動畫：閃爍、警示燈、燭光、雷雨……",
    },
    "Turn on / off": {
        "fr": "Allumer / éteindre", "de": "Ein / aus", "es": "Encender / apagar", "it": "Accendi / spegni",
        "ja": "オン / オフ", "ko": "켜기 / 끄기", "zh_CN": "开 / 关", "zh_TW": "開 / 關",
    },
    "Adjust brightness": {
        "fr": "Régler l'intensité", "de": "Helligkeit regeln", "es": "Ajustar intensidad", "it": "Regola intensità",
        "ja": "明るさを調整", "ko": "밝기 조절", "zh_CN": "调节亮度", "zh_TW": "調整亮度",
    },
    "Rotate the hue": {
        "fr": "Faire tourner la teinte", "de": "Farbton drehen", "es": "Girar el tono", "it": "Ruota la tonalità",
        "ja": "色相を回す", "ko": "색조 회전", "zh_CN": "转动色相", "zh_TW": "轉動色相",
    },
    "Adjust the white": {
        "fr": "Régler le blanc", "de": "Weiß regeln", "es": "Ajustar el blanco", "it": "Regola il bianco",
        "ja": "白色温度を調整", "ko": "백색 온도 조절", "zh_CN": "调节白光", "zh_TW": "調整白光",
    },
    "Start / stop the scenario": {
        "fr": "Lancer / arrêter le scénario",
        "de": "Szenario starten / stoppen",
        "es": "Iniciar / detener el escenario",
        "it": "Avvia / ferma lo scenario",
        "ja": "シナリオを開始 / 停止",
        "ko": "시나리오 시작 / 정지",
        "zh_CN": "启动 / 停止情景",
        "zh_TW": "啟動 / 停止情境",
    },
}

# --- Plugin et panneaux : cles en chemin pointe ------------------------------
ARBRE = {
    # Mots ecrits sur la touche. Les garder COURTS : ils sont rendus a 72 px.
    "key.toSet": {
        "en": "Set up", "fr": "À régler", "de": "Einrichten", "es": "Configurar", "it": "Da impostare",
        "ja": "未設定", "ko": "설정 필요", "zh_CN": "待设置", "zh_TW": "待設定",
    },
    "key.offline": {
        "en": "Offline", "fr": "Hors ligne", "de": "Offline", "es": "Sin conexión", "it": "Non in linea",
        "ja": "オフライン", "ko": "오프라인", "zh_CN": "离线", "zh_TW": "離線",
    },
    # La SEULE panne que l'utilisateur repare seul, depuis le panneau : elle se
    # distingue donc de « hors ligne », qui ne lui demande rien.
    "key.badKey": {
        "en": "Bad key", "fr": "Clé refusée", "de": "Key falsch", "es": "Clave errónea", "it": "Chiave errata",
        "ja": "キー不一致", "ko": "키 오류", "zh_CN": "密钥错误", "zh_TW": "密鑰錯誤",
    },
    # Repli pour ce qu'on ne sait pas nommer. Volontairement muet sur la cause :
    # un diagnostic invente enverrait l'utilisateur demonter son pare-feu pour rien.
    "key.error": {
        "en": "Error", "fr": "Erreur", "de": "Fehler", "es": "Error", "it": "Errore",
        "ja": "エラー", "ko": "오류", "zh_CN": "错误", "zh_TW": "錯誤",
    },
    "key.on": {
        "en": "On", "fr": "Allumée", "de": "An", "es": "Encendida", "it": "Accesa",
        "ja": "オン", "ko": "켜짐", "zh_CN": "开", "zh_TW": "開",
    },
    "key.off": {
        "en": "Off", "fr": "Éteinte", "de": "Aus", "es": "Apagada", "it": "Spenta",
        "ja": "オフ", "ko": "꺼짐", "zh_CN": "关", "zh_TW": "關",
    },
    "key.noColour": {
        "en": "No colour", "fr": "Sans couleur", "de": "Keine Farbe", "es": "Sin color", "it": "Senza colore",
        "ja": "色非対応", "ko": "색상 미지원", "zh_CN": "不支持颜色", "zh_TW": "不支援顏色",
    },
    "key.noWhite": {
        "en": "No white", "fr": "Sans blanc", "de": "Kein Weiß", "es": "Sin blanco", "it": "Senza bianco",
        "ja": "白色非対応", "ko": "백색 미지원", "zh_CN": "不支持白光", "zh_TW": "不支援白光",
    },

    # Qualificatifs de blanc, pour que la molette dise plus qu'un nombre.
    "warmth.warm": {
        "en": "Warm", "fr": "Chaud", "de": "Warm", "es": "Cálido", "it": "Caldo",
        "ja": "暖色", "ko": "따뜻함", "zh_CN": "暖色", "zh_TW": "暖色",
    },
    "warmth.neutral": {
        "en": "Neutral", "fr": "Neutre", "de": "Neutral", "es": "Neutro", "it": "Neutro",
        "ja": "中間色", "ko": "중간", "zh_CN": "中性", "zh_TW": "中性",
    },
    "warmth.cool": {
        "en": "Cool", "fr": "Froid", "de": "Kalt", "es": "Frío", "it": "Freddo",
        "ja": "寒色", "ko": "차가움", "zh_CN": "冷色", "zh_TW": "冷色",
    },
    "warmth.daylight": {
        "en": "Daylight", "fr": "Lumière du jour", "de": "Tageslicht", "es": "Luz de día", "it": "Luce diurna",
        "ja": "昼光色", "ko": "주광색", "zh_CN": "日光", "zh_TW": "日光",
    },

    # Titres affiches sur l'ecran d'une molette Stream Deck+.
    "dial.brightness": {
        "en": "Brightness", "fr": "Intensité", "de": "Helligkeit", "es": "Intensidad", "it": "Intensità",
        "ja": "明るさ", "ko": "밝기", "zh_CN": "亮度", "zh_TW": "亮度",
    },
    "dial.colour": {
        "en": "Colour", "fr": "Couleur", "de": "Farbe", "es": "Color", "it": "Colore",
        "ja": "色", "ko": "색상", "zh_CN": "颜色", "zh_TW": "顏色",
    },
    "dial.white": {
        "en": "White", "fr": "Blanc", "de": "Weiß", "es": "Blanco", "it": "Bianco",
        "ja": "白色", "ko": "백색", "zh_CN": "白光", "zh_TW": "白光",
    },
    "dial.scenario": {
        "en": "Scenario", "fr": "Scénario", "de": "Szenario", "es": "Escenario", "it": "Scenario",
        "ja": "シナリオ", "ko": "시나리오", "zh_CN": "情景", "zh_TW": "情境",
    },

    # Noms grossiers de teintes, pour que la molette dise autre chose qu'un nombre.
    "hue.red": {
        "en": "Red", "fr": "Rouge", "de": "Rot", "es": "Rojo", "it": "Rosso",
        "ja": "赤", "ko": "빨강", "zh_CN": "红色", "zh_TW": "紅色",
    },
    "hue.orange": {
        "en": "Orange", "fr": "Orange", "de": "Orange", "es": "Naranja", "it": "Arancione",
        "ja": "オレンジ", "ko": "주황", "zh_CN": "橙色", "zh_TW": "橙色",
    },
    "hue.yellow": {
        "en": "Yellow", "fr": "Jaune", "de": "Gelb", "es": "Amarillo", "it": "Giallo",
        "ja": "黄", "ko": "노랑", "zh_CN": "黄色", "zh_TW": "黃色",
    },
    "hue.green": {
        "en": "Green", "fr": "Vert", "de": "Grün", "es": "Verde", "it": "Verde",
        "ja": "緑", "ko": "초록", "zh_CN": "绿色", "zh_TW": "綠色",
    },
    "hue.cyan": {
        "en": "Cyan", "fr": "Cyan", "de": "Cyan", "es": "Cian", "it": "Ciano",
        "ja": "シアン", "ko": "청록", "zh_CN": "青色", "zh_TW": "青色",
    },
    "hue.blue": {
        "en": "Blue", "fr": "Bleu", "de": "Blau", "es": "Azul", "it": "Blu",
        "ja": "青", "ko": "파랑", "zh_CN": "蓝色", "zh_TW": "藍色",
    },
    "hue.violet": {
        "en": "Violet", "fr": "Violet", "de": "Violett", "es": "Violeta", "it": "Viola",
        "ja": "紫", "ko": "보라", "zh_CN": "紫色", "zh_TW": "紫色",
    },
    "hue.pink": {
        "en": "Pink", "fr": "Rose", "de": "Rosa", "es": "Rosa", "it": "Rosa",
        "ja": "ピンク", "ko": "분홍", "zh_CN": "粉色", "zh_TW": "粉紅",
    },

    # Scenarios. Les identifiants restent en francais : ce sont des cles stables
    # deja enregistrees dans les reglages des utilisateurs, les renommer casserait
    # leurs touches.
    "scenario.clignotement.name": {
        "en": "Blink", "fr": "Clignotement", "de": "Blinken", "es": "Parpadeo", "it": "Lampeggio",
        "ja": "点滅", "ko": "깜빡임", "zh_CN": "闪烁", "zh_TW": "閃爍",
    },
    "scenario.clignotement.description": {
        "en": "The bulb switches on and off endlessly. Useful as a timer visible from across the room.",
        "fr": "L'ampoule s'allume et s'éteint sans fin. Utile comme minuteur visible de loin.",
        "de": "Die Lampe schaltet endlos ein und aus. Nützlich als von weitem sichtbarer Timer.",
        "es": "La bombilla se enciende y se apaga sin fin. Útil como temporizador visible de lejos.",
        "it": "La lampadina si accende e si spegne senza fine. Utile come timer visibile da lontano.",
        "ja": "電球が延々とオン・オフを繰り返します。離れた場所からも見えるタイマーとして便利です。",
        "ko": "전구가 끝없이 켜졌다 꺼집니다. 멀리서도 보이는 타이머로 유용합니다.",
        "zh_CN": "灯泡不停地亮灭。适合当作远处也能看见的计时提示。",
        "zh_TW": "燈泡不停地亮滅。適合當作遠處也看得見的計時提示。",
    },
    "scenario.gyrophare.name": {
        "en": "Police lights", "fr": "Gyrophare", "de": "Blaulicht", "es": "Luces de policía", "it": "Lampeggiante",
        "ja": "パトカー", "ko": "경광등", "zh_CN": "警灯", "zh_TW": "警示燈",
    },
    "scenario.gyrophare.description": {
        "en": "Alternating red and blue, like a police car. With two bulbs, they answer each other.",
        "fr": "Rouge et bleu alternés, façon voiture de police. Avec deux ampoules, elles se répondent.",
        "de": "Rot und Blau im Wechsel, wie ein Polizeiwagen. Mit zwei Lampen antworten sie einander.",
        "es": "Rojo y azul alternos, como un coche de policía. Con dos bombillas, se responden.",
        "it": "Rosso e blu alternati, come un'auto della polizia. Con due lampadine si rispondono.",
        "ja": "赤と青が交互に光る、パトカー風の演出。電球が二つあれば互いに応答します。",
        "ko": "빨강과 파랑이 번갈아 빛나는 경찰차 연출. 전구가 둘이면 서로 주고받습니다.",
        "zh_CN": "红蓝交替，如同警车。若有两只灯泡，它们会互相呼应。",
        "zh_TW": "紅藍交替，如同警車。若有兩顆燈泡，它們會互相呼應。",
    },
    "scenario.respiration.name": {
        "en": "Breathe", "fr": "Respiration", "de": "Atmen", "es": "Respiración", "it": "Respiro",
        "ja": "呼吸", "ko": "호흡", "zh_CN": "呼吸", "zh_TW": "呼吸",
    },
    "scenario.respiration.description": {
        "en": "Brightness rises and falls slowly, keeping the colour in place. Calm, for working.",
        "fr": "L'intensité monte et descend lentement, en gardant la couleur en place. Calme, pour travailler.",
        "de": "Die Helligkeit steigt und fällt langsam, die Farbe bleibt. Ruhig, zum Arbeiten.",
        "es": "La intensidad sube y baja lentamente, manteniendo el color. Tranquilo, para trabajar.",
        "it": "L'intensità sale e scende lentamente, mantenendo il colore. Calmo, per lavorare.",
        "ja": "色はそのままに、明るさがゆっくり上下します。作業中に落ち着く演出です。",
        "ko": "색은 그대로 두고 밝기만 천천히 오르내립니다. 작업할 때 차분합니다.",
        "zh_CN": "亮度缓缓起伏，颜色保持不变。安静，适合工作时使用。",
        "zh_TW": "亮度緩緩起伏，顏色保持不變。安靜，適合工作時使用。",
    },
    "scenario.bougie.name": {
        "en": "Candle", "fr": "Bougie", "de": "Kerze", "es": "Vela", "it": "Candela",
        "ja": "ろうそく", "ko": "촛불", "zh_CN": "烛光", "zh_TW": "燭光",
    },
    "scenario.bougie.description": {
        "en": "A warm flame that flickers, never twice the same. The prettiest of the set.",
        "fr": "Une flamme chaude qui vacille, jamais deux fois pareil. Le plus joli de la série.",
        "de": "Eine warme Flamme, die flackert, nie zweimal gleich. Der schönste der Reihe.",
        "es": "Una llama cálida que titila, nunca dos veces igual. El más bonito de la serie.",
        "it": "Una fiamma calda che tremola, mai due volte uguale. Il più bello della serie.",
        "ja": "暖かな炎が揺らめきます。同じ揺れ方は二度とありません。この中でいちばん美しい演出です。",
        "ko": "따뜻한 불꽃이 흔들립니다. 같은 흔들림은 두 번 없습니다. 이 중에서 가장 예쁩니다.",
        "zh_CN": "温暖的火焰摇曳不定，从不重复。这一组里最好看的一个。",
        "zh_TW": "溫暖的火焰搖曳不定，從不重複。這一組裡最好看的一個。",
    },
    "scenario.orage.name": {
        "en": "Storm", "fr": "Orage", "de": "Gewitter", "es": "Tormenta", "it": "Temporale",
        "ja": "雷雨", "ko": "폭풍", "zh_CN": "雷雨", "zh_TW": "雷雨",
    },
    "scenario.orage.description": {
        "en": "A blue gloom, torn by white flashes at irregular intervals.",
        "fr": "Une pénombre bleutée, déchirée par des éclairs blancs à intervalles irréguliers.",
        "de": "Ein blaues Halbdunkel, zerrissen von weißen Blitzen in unregelmäßigen Abständen.",
        "es": "Una penumbra azulada, rasgada por destellos blancos a intervalos irregulares.",
        "it": "Una penombra bluastra, squarciata da lampi bianchi a intervalli irregolari.",
        "ja": "青みがかった薄闇を、白い稲光が不規則に切り裂きます。",
        "ko": "푸르스름한 어스름을 흰 섬광이 불규칙하게 가릅니다.",
        "zh_CN": "泛蓝的幽暗，被不规则的白色闪电划破。",
        "zh_TW": "泛藍的幽暗，被不規則的白色閃電劃破。",
    },
    "scenario.arc-en-ciel.name": {
        "en": "Rainbow", "fr": "Arc-en-ciel", "de": "Regenbogen", "es": "Arcoíris", "it": "Arcobaleno",
        "ja": "虹", "ko": "무지개", "zh_CN": "彩虹", "zh_TW": "彩虹",
    },
    "scenario.arc-en-ciel.description": {
        "en": "The hue turns gently around the whole colour wheel.",
        "fr": "La teinte tourne doucement sur tout le cercle chromatique.",
        "de": "Der Farbton wandert sanft über den ganzen Farbkreis.",
        "es": "El tono gira suavemente por todo el círculo cromático.",
        "it": "La tonalità ruota dolcemente su tutto il cerchio cromatico.",
        "ja": "色相が色相環をゆっくり一周します。",
        "ko": "색조가 색상환을 천천히 한 바퀴 돕니다.",
        "zh_CN": "色相沿着整个色环缓缓转动。",
        "zh_TW": "色相沿著整個色環緩緩轉動。",
    },
    "scenario.alerte.name": {
        "en": "Alert", "fr": "Alerte", "de": "Alarm", "es": "Alerta", "it": "Allerta",
        "ja": "アラート", "ko": "알림", "zh_CN": "警报", "zh_TW": "警報",
    },
    "scenario.alerte.description": {
        "en": "Three red flashes, then the lamp returns exactly as it was. To signal an event.",
        "fr": "Trois éclats rouges, puis la lampe revient exactement comme elle était. Pour signaler un événement.",
        "de": "Drei rote Blitze, dann kehrt die Lampe genau in ihren Zustand zurück. Um ein Ereignis zu melden.",
        "es": "Tres destellos rojos, luego la lámpara vuelve exactamente a su estado. Para señalar un evento.",
        "it": "Tre lampi rossi, poi la lampada torna esattamente com'era. Per segnalare un evento.",
        "ja": "赤く三回光ったあと、電球は元の状態に正確に戻ります。出来事を知らせる用途に。",
        "ko": "빨갛게 세 번 번쩍인 뒤, 전구는 원래 상태로 정확히 돌아갑니다. 사건을 알릴 때 씁니다.",
        "zh_CN": "红光闪三下，然后灯泡准确回到原来的状态。用于提示某个事件。",
        "zh_TW": "紅光閃三下，然後燈泡準確回到原本的狀態。用於提示某個事件。",
    },
    "scenario.lever-de-soleil.name": {
        "en": "Sunrise", "fr": "Lever de soleil", "de": "Sonnenaufgang", "es": "Amanecer", "it": "Alba",
        "ja": "日の出", "ko": "일출", "zh_CN": "日出", "zh_TW": "日出",
    },
    "scenario.lever-de-soleil.description": {
        "en": "Five minutes from dark embers to broad daylight. Start it to wake up gently.",
        "fr": "Cinq minutes d'une braise sombre jusqu'au plein jour. À lancer pour se réveiller en douceur.",
        "de": "Fünf Minuten von dunkler Glut bis zum hellen Tag. Zum sanften Aufwachen.",
        "es": "Cinco minutos de brasa oscura hasta la plena luz del día. Para despertar suavemente.",
        "it": "Cinque minuti da brace scura a pieno giorno. Da avviare per svegliarsi dolcemente.",
        "ja": "暗い熾火から白昼まで五分かけて。おだやかに目覚めたいときに。",
        "ko": "어두운 잉걸불에서 한낮까지 오 분에 걸쳐. 부드럽게 깨어나고 싶을 때.",
        "zh_CN": "五分钟，从暗红余烬到明亮白昼。适合用来温柔地醒来。",
        "zh_TW": "五分鐘，從暗紅餘燼到明亮白晝。適合用來溫柔地醒來。",
    },

    # --- Panneaux de configuration -----------------------------------------
    "pi.bulb": {
        "en": "Bulb", "fr": "Ampoule", "de": "Lampe", "es": "Bombilla", "it": "Lampadina",
        "ja": "電球", "ko": "전구", "zh_CN": "灯泡", "zh_TW": "燈泡",
    },
    "pi.bulbPlaceholder": {
        "en": "Choose a bulb", "fr": "Choisissez une ampoule", "de": "Lampe wählen",
        "es": "Elija una bombilla", "it": "Scegli una lampadina",
        "ja": "電球を選択", "ko": "전구 선택", "zh_CN": "选择灯泡", "zh_TW": "選擇燈泡",
    },
    "pi.secondBulb": {
        "en": "Second bulb", "fr": "Seconde ampoule", "de": "Zweite Lampe", "es": "Segunda bombilla",
        "it": "Seconda lampadina", "ja": "2 つ目の電球", "ko": "두 번째 전구",
        "zh_CN": "第二只灯泡", "zh_TW": "第二顆燈泡",
    },
    "pi.secondBulbPlaceholder": {
        "en": "None (optional)", "fr": "Aucune (facultatif)", "de": "Keine (optional)",
        "es": "Ninguna (opcional)", "it": "Nessuna (facoltativa)",
        "ja": "なし（任意）", "ko": "없음(선택)", "zh_CN": "无（可选）", "zh_TW": "無（選填）",
    },
    "pi.scenario": {
        "en": "Scenario", "fr": "Scénario", "de": "Szenario", "es": "Escenario", "it": "Scenario",
        "ja": "シナリオ", "ko": "시나리오", "zh_CN": "情景", "zh_TW": "情境",
    },
    "pi.scenarioPlaceholder": {
        "en": "Choose a scenario", "fr": "Choisissez un scénario", "de": "Szenario wählen",
        "es": "Elija un escenario", "it": "Scegli uno scenario",
        "ja": "シナリオを選択", "ko": "시나리오 선택", "zh_CN": "选择情景", "zh_TW": "選擇情境",
    },
    "pi.colour": {
        "en": "Colour", "fr": "Couleur", "de": "Farbe", "es": "Color", "it": "Colore",
        "ja": "色", "ko": "색상", "zh_CN": "颜色", "zh_TW": "顏色",
    },
    "pi.step": {
        "en": "Step", "fr": "Pas", "de": "Schritt", "es": "Paso", "it": "Passo",
        "ja": "刻み幅", "ko": "단계", "zh_CN": "步长", "zh_TW": "級距",
    },
    "pi.hueStep": {
        "en": "Hue step", "fr": "Pas de teinte", "de": "Farbton-Schritt", "es": "Paso de tono",
        "it": "Passo di tonalità", "ja": "色相の刻み幅", "ko": "색조 단계",
        "zh_CN": "色相步长", "zh_TW": "色相級距",
    },
    "pi.dialStep": {
        "en": "Dial step", "fr": "Pas de molette", "de": "Drehknopf-Schritt", "es": "Paso del dial",
        "it": "Passo manopola", "ja": "ダイヤルの刻み幅", "ko": "다이얼 단계",
        "zh_CN": "旋钮步长", "zh_TW": "旋鈕級距",
    },
    "pi.temperature": {
        "en": "Temperature", "fr": "Température", "de": "Temperatur", "es": "Temperatura",
        "it": "Temperatura", "ja": "色温度", "ko": "색온도", "zh_CN": "色温", "zh_TW": "色溫",
    },

    "pi.manage": {
        "en": "Add or edit a bulb", "fr": "Ajouter ou modifier une ampoule",
        "de": "Lampe hinzufügen oder bearbeiten", "es": "Añadir o editar una bombilla",
        "it": "Aggiungi o modifica una lampadina",
        "ja": "電球を追加・編集", "ko": "전구 추가 또는 편집",
        "zh_CN": "添加或修改灯泡", "zh_TW": "新增或修改燈泡",
    },

    "pi.shared.title": {
        "en": "One bulb, many keys", "fr": "Une ampoule, plusieurs touches",
        "de": "Eine Lampe, viele Tasten", "es": "Una bombilla, varias teclas",
        "it": "Una lampadina, più tasti",
        "ja": "一つの電球、複数のキー", "ko": "전구 하나, 여러 키",
        "zh_CN": "一只灯泡，多个按键", "zh_TW": "一顆燈泡，多個按鍵",
    },
    "pi.shared.body": {
        "en": "Bulbs are declared once for the whole plugin. Every key picks from the same list: no need to retype the key each time, and a changed key is fixed in a single place.",
        "fr": "Les ampoules se déclarent une seule fois pour tout le plugin. Toutes vos touches piochent dans la même liste : inutile de ressaisir la clé à chaque fois, et une clé changée ne se corrige qu'à un seul endroit.",
        "de": "Lampen werden einmal für das ganze Plugin angelegt. Alle Tasten greifen auf dieselbe Liste zu: der Schlüssel muss nicht jedes Mal neu eingegeben werden, und ein geänderter Schlüssel wird nur an einer Stelle korrigiert.",
        "es": "Las bombillas se declaran una sola vez para todo el plugin. Todas las teclas toman de la misma lista: no hay que reescribir la clave cada vez, y una clave cambiada se corrige en un solo sitio.",
        "it": "Le lampadine si dichiarano una sola volta per tutto il plugin. Tutti i tasti attingono dalla stessa lista: non serve reinserire la chiave ogni volta, e una chiave cambiata si corregge in un solo punto.",
        "ja": "電球はプラグイン全体で一度だけ登録します。すべてのキーが同じ一覧から選ぶので、毎回キーを入力し直す必要はなく、変更も一箇所で済みます。",
        "ko": "전구는 플러그인 전체에서 한 번만 등록합니다. 모든 키가 같은 목록에서 고르므로 매번 키를 다시 입력할 필요가 없고, 키가 바뀌어도 한 곳만 고치면 됩니다.",
        "zh_CN": "灯泡只需为整个插件登记一次。所有按键都从同一个列表中选择：无需每次重新输入密钥，密钥变更也只需在一处修改。",
        "zh_TW": "燈泡只需為整個外掛登記一次。所有按鍵都從同一個清單中選擇：無需每次重新輸入金鑰，金鑰變更也只需在一處修改。",
    },

    "pi.stepHelp.title": {
        "en": "What is the step for?", "fr": "À quoi sert le pas ?",
        "de": "Wozu dient der Schritt?", "es": "¿Para qué sirve el paso?",
        "it": "A cosa serve il passo?",
        "ja": "刻み幅とは？", "ko": "단계는 무엇인가요?",
        "zh_CN": "步长有什么用？", "zh_TW": "級距有什麼用？",
    },
    "pi.stepHelp.key": {
        "en": "On a key, each press applies this step. A negative value makes a “dim” key: place two side by side, one at +10 and one at -10.",
        "fr": "Sur une touche, chaque appui applique ce pas. Une valeur négative fait une touche « baisser » : posez-en deux côte à côte, l'une à +10 et l'autre à -10.",
        "de": "Auf einer Taste wendet jeder Druck diesen Schritt an. Ein negativer Wert ergibt eine „Dimmen“-Taste: legen Sie zwei nebeneinander, eine mit +10 und eine mit -10.",
        "es": "En una tecla, cada pulsación aplica este paso. Un valor negativo crea una tecla de «bajar»: coloque dos juntas, una a +10 y otra a -10.",
        "it": "Su un tasto, ogni pressione applica questo passo. Un valore negativo crea un tasto «abbassa»: mettine due affiancati, uno a +10 e uno a -10.",
        "ja": "キーでは、押すたびにこの刻み幅が適用されます。負の値にすると「暗くする」キーになります。+10 と -10 を並べて置くと便利です。",
        "ko": "키에서는 누를 때마다 이 단계가 적용됩니다. 음수 값을 주면 «어둡게» 키가 됩니다. +10과 -10을 나란히 두면 편합니다.",
        "zh_CN": "在按键上，每按一次就应用一次该步长。负值会变成「调暗」键：把两个并排放置，一个 +10，一个 -10。",
        "zh_TW": "在按鍵上，每按一次就套用一次該級距。負值會變成「調暗」鍵：把兩個並排放置，一個 +10，一個 -10。",
    },
    "pi.stepHelp.dial": {
        "en": "On a dial, the step is the value of one detent; its sign is ignored, the direction of rotation decides.",
        "fr": "Sur une molette, le pas est la valeur d'un cran ; son signe est ignoré, c'est le sens de rotation qui décide.",
        "de": "Am Drehknopf ist der Schritt der Wert einer Raste; das Vorzeichen wird ignoriert, die Drehrichtung entscheidet.",
        "es": "En un dial, el paso es el valor de una muesca; su signo se ignora, decide el sentido de giro.",
        "it": "Su una manopola, il passo è il valore di uno scatto; il segno viene ignorato, decide il senso di rotazione.",
        "ja": "ダイヤルでは、刻み幅は一目盛りの値です。符号は無視され、回す向きで決まります。",
        "ko": "다이얼에서는 단계가 한 눈금의 값입니다. 부호는 무시되고 돌리는 방향이 결정합니다.",
        "zh_CN": "在旋钮上，步长是一格的数值；正负号会被忽略，由旋转方向决定。",
        "zh_TW": "在旋鈕上，級距是一格的數值；正負號會被忽略，由旋轉方向決定。",
    },

    "pi.tempHelp.title": {
        "en": "Temperature landmarks", "fr": "Repères de température",
        "de": "Temperatur-Orientierung", "es": "Referencias de temperatura",
        "it": "Riferimenti di temperatura",
        "ja": "色温度の目安", "ko": "색온도 기준",
        "zh_CN": "色温参考", "zh_TW": "色溫參考",
    },
    "pi.tempHelp.scale": {
        "en": "2700 K matches an incandescent bulb, very warm. 4000 K is a neutral white. 6500 K is daylight, cool and blue.",
        "fr": "2700 K correspond à une ampoule à incandescence, très chaude. 4000 K est un blanc neutre. 6500 K est la lumière du jour, froide et bleutée.",
        "de": "2700 K entspricht einer Glühlampe, sehr warm. 4000 K ist ein neutrales Weiß. 6500 K ist Tageslicht, kalt und bläulich.",
        "es": "2700 K corresponde a una bombilla incandescente, muy cálida. 4000 K es un blanco neutro. 6500 K es luz de día, fría y azulada.",
        "it": "2700 K corrisponde a una lampadina a incandescenza, molto calda. 4000 K è un bianco neutro. 6500 K è luce diurna, fredda e bluastra.",
        "ja": "2700 K は白熱電球に相当し、とても暖かい光です。4000 K は中間的な白。6500 K は昼光色で、青みがかった冷たい光です。",
        "ko": "2700 K는 백열전구에 해당하는 매우 따뜻한 빛입니다. 4000 K는 중간 백색. 6500 K는 주광색으로 푸르고 차가운 빛입니다.",
        "zh_CN": "2700 K 相当于白炽灯，非常暖。4000 K 是中性白。6500 K 是日光色，偏冷偏蓝。",
        "zh_TW": "2700 K 相當於白熾燈，非常暖。4000 K 是中性白。6500 K 是日光色，偏冷偏藍。",
    },
    "pi.tempHelp.mode": {
        "en": "Applying a temperature switches the bulb to white mode, so it leaves colour behind. The bulb imposes this, not the plugin.",
        "fr": "Appliquer une température fait passer l'ampoule en mode blanc : elle quitte donc la couleur. C'est l'ampoule qui l'impose, pas le plugin.",
        "de": "Eine Temperatur zu setzen schaltet die Lampe in den Weißmodus, sie verlässt also die Farbe. Das gibt die Lampe vor, nicht das Plugin.",
        "es": "Aplicar una temperatura pasa la bombilla a modo blanco, por lo que abandona el color. Lo impone la bombilla, no el plugin.",
        "it": "Applicare una temperatura porta la lampadina in modo bianco, quindi abbandona il colore. Lo impone la lampadina, non il plugin.",
        "ja": "色温度を適用すると電球は白色モードに切り替わり、色を離れます。これは電球側の仕様で、プラグインの都合ではありません。",
        "ko": "색온도를 적용하면 전구가 백색 모드로 전환되어 색상을 벗어납니다. 플러그인이 아니라 전구가 정한 동작입니다.",
        "zh_CN": "应用色温会让灯泡切换到白光模式，因而离开彩色。这是灯泡本身的限制，不是插件造成的。",
        "zh_TW": "套用色溫會讓燈泡切換到白光模式，因而離開彩色。這是燈泡本身的限制，不是外掛造成的。",
    },

    "pi.colourHelp.title": {
        "en": "How do key and dial behave?", "fr": "Comment se comportent touche et molette ?",
        "de": "Wie verhalten sich Taste und Drehknopf?", "es": "¿Cómo se comportan tecla y dial?",
        "it": "Come si comportano tasto e manopola?",
        "ja": "キーとダイヤルの動作", "ko": "키와 다이얼의 동작",
        "zh_CN": "按键和旋钮如何工作？", "zh_TW": "按鍵和旋鈕如何運作？",
    },
    "pi.colourHelp.key": {
        "en": "On a key, one press turns the bulb on and applies exactly the colour chosen above. Place several for your favourite moods.",
        "fr": "Sur une touche, un appui allume l'ampoule et applique exactement la couleur choisie ci-dessus. Posez-en plusieurs pour vos ambiances favorites.",
        "de": "Auf einer Taste schaltet ein Druck die Lampe ein und setzt genau die oben gewählte Farbe. Legen Sie mehrere für Ihre Lieblingsstimmungen an.",
        "es": "En una tecla, una pulsación enciende la bombilla y aplica exactamente el color elegido arriba. Ponga varias para sus ambientes favoritos.",
        "it": "Su un tasto, una pressione accende la lampadina e applica esattamente il colore scelto sopra. Mettine diversi per le tue atmosfere preferite.",
        "ja": "キーを押すと電球が点灯し、上で選んだ色がそのまま適用されます。お気に入りの雰囲気ごとに複数置くと便利です。",
        "ko": "키를 누르면 전구가 켜지고 위에서 고른 색이 그대로 적용됩니다. 좋아하는 분위기마다 여러 개 두면 좋습니다.",
        "zh_CN": "按下按键会点亮灯泡，并原样应用上面选定的颜色。可以为常用的氛围各放一个。",
        "zh_TW": "按下按鍵會點亮燈泡，並原樣套用上面選定的顏色。可以為常用的氛圍各放一個。",
    },
    "pi.colourHelp.dial": {
        "en": "On a dial, rotating turns the hue while keeping the bulb's current brightness. Pressing the dial toggles power.",
        "fr": "Sur une molette, la rotation fait tourner la teinte en conservant l'intensité actuelle de l'ampoule. Un appui sur la molette allume ou éteint.",
        "de": "Am Drehknopf dreht die Rotation den Farbton und behält die aktuelle Helligkeit bei. Ein Druck schaltet ein oder aus.",
        "es": "En un dial, girar cambia el tono conservando la intensidad actual. Pulsar el dial enciende o apaga.",
        "it": "Su una manopola, la rotazione ruota la tonalità mantenendo l'intensità attuale. Premere accende o spegne.",
        "ja": "ダイヤルを回すと、電球の現在の明るさを保ったまま色相が変わります。押すとオン・オフを切り替えます。",
        "ko": "다이얼을 돌리면 현재 밝기를 유지한 채 색조가 바뀝니다. 누르면 켜짐과 꺼짐이 전환됩니다.",
        "zh_CN": "转动旋钮会改变色相，同时保持灯泡当前的亮度。按下旋钮则开关灯。",
        "zh_TW": "轉動旋鈕會改變色相，同時保持燈泡目前的亮度。按下旋鈕則開關燈。",
    },

    "pi.scenarioHelp.title": {
        "en": "How does it work?", "fr": "Comment ça marche ?", "de": "Wie funktioniert das?",
        "es": "¿Cómo funciona?", "it": "Come funziona?",
        "ja": "どう動きますか？", "ko": "어떻게 작동하나요?",
        "zh_CN": "它是怎么工作的？", "zh_TW": "它是怎麼運作的？",
    },
    "pi.scenarioHelp.toggle": {
        "en": "One press starts the scenario, a second stops it. The lamp then returns exactly to the state it was in: same colour, same brightness, on or off.",
        "fr": "Un appui lance le scénario, un second l'arrête. La lampe revient alors exactement dans l'état où elle était : même couleur, même intensité, allumée ou éteinte.",
        "de": "Ein Druck startet das Szenario, ein zweiter stoppt es. Die Lampe kehrt dann genau in ihren vorherigen Zustand zurück: gleiche Farbe, gleiche Helligkeit, ein oder aus.",
        "es": "Una pulsación inicia el escenario, otra lo detiene. La lámpara vuelve exactamente al estado en que estaba: mismo color, misma intensidad, encendida o apagada.",
        "it": "Una pressione avvia lo scenario, una seconda lo ferma. La lampada torna esattamente allo stato precedente: stesso colore, stessa intensità, accesa o spenta.",
        "ja": "一度押すとシナリオが始まり、もう一度押すと止まります。電球は元の状態に正確に戻ります。色も明るさも、点灯・消灯もそのままです。",
        "ko": "한 번 누르면 시나리오가 시작되고, 다시 누르면 멈춥니다. 전구는 원래 상태로 정확히 돌아갑니다. 색도 밝기도, 켜짐·꺼짐도 그대로입니다.",
        "zh_CN": "按一次启动情景，再按一次停止。灯泡随后会准确回到原来的状态：相同的颜色、相同的亮度、开或关。",
        "zh_TW": "按一次啟動情境，再按一次停止。燈泡隨後會準確回到原本的狀態：相同的顏色、相同的亮度、開或關。",
    },
    "pi.scenarioHelp.second": {
        "en": "The second bulb is optional. Only Police lights uses two today, so they answer each other in red and blue. With one, it alternates both colours on the same lamp.",
        "fr": "La seconde ampoule est facultative. Seul le Gyrophare sait aujourd'hui en exploiter deux, pour qu'elles se répondent en rouge et bleu. Avec une seule, il alterne les deux couleurs sur la même lampe.",
        "de": "Die zweite Lampe ist optional. Nur Blaulicht nutzt heute zwei, damit sie sich in Rot und Blau antworten. Mit einer wechselt es beide Farben auf derselben Lampe.",
        "es": "La segunda bombilla es opcional. Solo Luces de policía usa dos hoy, para que se respondan en rojo y azul. Con una, alterna ambos colores en la misma lámpara.",
        "it": "La seconda lampadina è facoltativa. Solo Lampeggiante ne usa due oggi, perché si rispondano in rosso e blu. Con una sola, alterna i due colori sulla stessa lampada.",
        "ja": "2 つ目の電球は任意です。今のところ二つを使うのはパトカーだけで、赤と青で互いに応答します。一つだけなら同じ電球で両色を交互に出します。",
        "ko": "두 번째 전구는 선택 사항입니다. 현재 두 개를 쓰는 것은 경광등뿐이며, 빨강과 파랑으로 서로 주고받습니다. 하나만 있으면 같은 전구에서 두 색을 번갈아 냅니다.",
        "zh_CN": "第二只灯泡是可选的。目前只有警灯会用到两只，让它们以红蓝互相呼应。只有一只时，会在同一只灯泡上交替两种颜色。",
        "zh_TW": "第二顆燈泡是選填的。目前只有警示燈會用到兩顆，讓它們以紅藍互相呼應。只有一顆時，會在同一顆燈泡上交替兩種顏色。",
    },
    "pi.scenarioHelp.oneShot": {
        "en": "Alert and Sunrise stop on their own, after three flashes and five minutes respectively. The others run until you press again.",
        "fr": "Alerte et Lever de soleil s'arrêtent tout seuls, après trois éclats pour le premier et cinq minutes pour le second. Les autres tournent jusqu'à ce que vous appuyiez de nouveau.",
        "de": "Alarm und Sonnenaufgang stoppen von selbst, nach drei Blitzen bzw. fünf Minuten. Die anderen laufen, bis Sie erneut drücken.",
        "es": "Alerta y Amanecer se detienen solos, tras tres destellos y cinco minutos respectivamente. Los demás siguen hasta que vuelva a pulsar.",
        "it": "Allerta e Alba si fermano da soli, dopo tre lampi e cinque minuti rispettivamente. Gli altri proseguono finché non premi di nuovo.",
        "ja": "アラートと日の出は自動で止まります。それぞれ三回の点滅後、五分後です。ほかのシナリオはもう一度押すまで続きます。",
        "ko": "알림과 일출은 각각 세 번의 점멸 뒤와 오 분 뒤에 스스로 멈춥니다. 나머지는 다시 누를 때까지 계속됩니다.",
        "zh_CN": "警报和日出会自行停止，分别在闪三下之后和五分钟之后。其余情景会一直运行，直到你再次按下。",
        "zh_TW": "警報和日出會自行停止，分別在閃三下之後和五分鐘之後。其餘情境會一直執行，直到你再次按下。",
    },
    "pi.scenarioHelp.safety": {
        "en": "Animations are deliberately capped at two alternations per second: beyond that, flashing light can trigger a seizure in a photosensitive person.",
        "fr": "Les animations sont volontairement plafonnées à deux alternances par seconde : au-delà, un clignotement peut déclencher une crise chez une personne photosensible.",
        "de": "Animationen sind bewusst auf zwei Wechsel pro Sekunde begrenzt: darüber hinaus kann Blinklicht bei photosensiblen Menschen einen Anfall auslösen.",
        "es": "Las animaciones están limitadas a propósito a dos alternancias por segundo: más allá, un parpadeo puede provocar una crisis en una persona fotosensible.",
        "it": "Le animazioni sono volutamente limitate a due alternanze al secondo: oltre, un lampeggio può scatenare una crisi in una persona fotosensibile.",
        "ja": "演出は毎秒 2 回の切り替えまでに意図的に制限しています。これを超える点滅は、光感受性のある方に発作を引き起こすおそれがあります。",
        "ko": "연출은 초당 2회 전환으로 의도적으로 제한했습니다. 그 이상의 점멸은 광과민성이 있는 분에게 발작을 유발할 수 있습니다.",
        "zh_CN": "动画被有意限制在每秒两次交替：超过这个频率，闪烁可能诱发光敏感人群的癫痫发作。",
        "zh_TW": "動畫被刻意限制在每秒兩次交替：超過此頻率，閃爍可能誘發光敏感族群的癲癇發作。",
    },

    # --- Recuperation des cles par QR code -----------------------------------
    "pi.cloud.title": {
        "en": "Get my keys automatically", "fr": "Récupérer mes clés automatiquement",
        "de": "Schlüssel automatisch holen", "es": "Obtener mis claves automáticamente",
        "it": "Recupera le mie chiavi automaticamente",
        "ja": "キーを自動で取得", "ko": "키 자동으로 가져오기",
        "zh_CN": "自动获取密钥", "zh_TW": "自動取得金鑰",
    },
    "pi.cloud.intro": {
        "en": "Scan a QR code with the Calex or Smart Life app and every bulb on your account is added, keys included. Nothing to copy by hand.",
        "fr": "Scannez un QR code avec l'application Calex ou Smart Life, et toutes les ampoules de votre compte sont ajoutées, clés comprises. Rien à recopier.",
        "de": "Scannen Sie einen QR-Code mit der Calex- oder Smart-Life-App, und alle Lampen Ihres Kontos werden samt Schlüssel hinzugefügt. Nichts abzutippen.",
        "es": "Escanee un código QR con la app Calex o Smart Life y todas las bombillas de su cuenta se añaden, claves incluidas. Nada que copiar a mano.",
        "it": "Scansiona un codice QR con l'app Calex o Smart Life e tutte le lampadine del tuo account vengono aggiunte, chiavi comprese. Niente da copiare.",
        "ja": "Calex または Smart Life アプリで QR コードを読み取るだけで、アカウント内のすべての電球がキーごと追加されます。手で写す作業はありません。",
        "ko": "Calex 또는 Smart Life 앱으로 QR 코드를 스캔하면 계정의 모든 전구가 키까지 함께 추가됩니다. 손으로 옮겨 적을 것이 없습니다.",
        "zh_CN": "用 Calex 或 Smart Life 应用扫描二维码，账号下的所有灯泡连同密钥一并加入。无需手动抄写。",
        "zh_TW": "用 Calex 或 Smart Life 應用程式掃描 QR code，帳號下的所有燈泡連同金鑰一併加入。無需手動抄寫。",
    },
    "pi.cloud.userCode": {
        "en": "User code", "fr": "Code utilisateur", "de": "Benutzercode",
        "es": "Código de usuario", "it": "Codice utente",
        "ja": "ユーザーコード", "ko": "사용자 코드", "zh_CN": "用户码", "zh_TW": "使用者代碼",
    },
    "pi.cloud.where": {
        "en": "In the app: Me → Settings → Account and security → User code",
        "fr": "Dans l'application : Moi → Paramètres → Compte et sécurité → Code utilisateur",
        "de": "In der App: Ich → Einstellungen → Konto und Sicherheit → Benutzercode",
        "es": "En la app: Yo → Ajustes → Cuenta y seguridad → Código de usuario",
        "it": "Nell'app: Io → Impostazioni → Account e sicurezza → Codice utente",
        "ja": "アプリで：マイページ → 設定 → アカウントとセキュリティ → ユーザーコード",
        "ko": "앱에서: 나 → 설정 → 계정 및 보안 → 사용자 코드",
        "zh_CN": "在应用中：我的 → 设置 → 账号与安全 → 用户码",
        "zh_TW": "在應用程式中：我的 → 設定 → 帳號與安全 → 使用者代碼",
    },
    "pi.cloud.button": {
        "en": "Show the QR code", "fr": "Afficher le QR code", "de": "QR-Code anzeigen",
        "es": "Mostrar el código QR", "it": "Mostra il codice QR",
        "ja": "QR コードを表示", "ko": "QR 코드 표시", "zh_CN": "显示二维码", "zh_TW": "顯示 QR code",
    },
    "pi.cloud.scan": {
        "en": "Scan this in the app: + (top right) → Scan. Valid for about two minutes.",
        "fr": "Scannez ceci dans l'application : + (en haut à droite) → Scanner. Valable environ deux minutes.",
        "de": "Scannen Sie dies in der App: + (oben rechts) → Scannen. Etwa zwei Minuten gültig.",
        "es": "Escanee esto en la app: + (arriba a la derecha) → Escanear. Válido unos dos minutos.",
        "it": "Scansiona questo nell'app: + (in alto a destra) → Scansiona. Valido circa due minuti.",
        "ja": "アプリで読み取ってください：右上の + → スキャン。有効時間は約 2 分です。",
        "ko": "앱에서 스캔하세요: 오른쪽 위 + → 스캔. 약 2분간 유효합니다.",
        "zh_CN": "在应用中扫描：右上角 + → 扫一扫。有效期约两分钟。",
        "zh_TW": "在應用程式中掃描：右上角 + → 掃一掃。有效時間約兩分鐘。",
    },
    "pi.cloud.waiting": {
        "en": "Waiting for the scan…", "fr": "En attente du scan…", "de": "Warte auf den Scan…",
        "es": "Esperando el escaneo…", "it": "In attesa della scansione…",
        "ja": "スキャンを待っています…", "ko": "스캔을 기다리는 중…",
        "zh_CN": "等待扫描…", "zh_TW": "等待掃描…",
    },
    "pi.cloud.added": {
        "en": "bulb(s) added", "fr": "ampoule(s) ajoutée(s)", "de": "Lampe(n) hinzugefügt",
        "es": "bombilla(s) añadida(s)", "it": "lampadina/e aggiunta/e",
        "ja": "個の電球を追加しました", "ko": "개의 전구를 추가했습니다",
        "zh_CN": "只灯泡已加入", "zh_TW": "顆燈泡已加入",
    },
    "pi.cloud.ignored": {
        "en": "other device(s) ignored: not lights.",
        "fr": "autre(s) appareil(s) ignoré(s) : ce ne sont pas des lampes.",
        "de": "weitere(s) Gerät(e) ignoriert: keine Leuchten.",
        "es": "otro(s) dispositivo(s) ignorado(s): no son luces.",
        "it": "altro/i dispositivo/i ignorato/i: non sono luci.",
        "ja": "件の機器を除外しました（照明ではありません）。",
        "ko": "대의 기기를 제외했습니다(조명이 아님).",
        "zh_CN": "个其他设备已忽略：不是灯具。",
        "zh_TW": "個其他裝置已忽略：不是燈具。",
    },
    "pi.cloud.expired": {
        "en": "The QR code expired before it was scanned. Try again.",
        "fr": "Le QR code a expiré avant d'être scanné. Recommencez.",
        "de": "Der QR-Code ist abgelaufen, bevor er gescannt wurde. Bitte erneut versuchen.",
        "es": "El código QR caducó antes de escanearse. Inténtelo de nuevo.",
        "it": "Il codice QR è scaduto prima della scansione. Riprova.",
        "ja": "QR コードは読み取られる前に期限切れになりました。もう一度お試しください。",
        "ko": "QR 코드가 스캔되기 전에 만료되었습니다. 다시 시도하세요.",
        "zh_CN": "二维码在扫描前已过期。请重试。",
        "zh_TW": "QR code 在掃描前已過期。請重試。",
    },

    # --- Assistant de recherche d'ampoules ----------------------------------
    "pi.scan.note": {
        "en": "The search first listens for the announcements your bulbs broadcast, then, if nothing arrives, knocks at every address on the network. Allow about twenty seconds in the worst case. It finds address and identifier, but never the key: that one still has to be pasted once per bulb.",
        "fr": "La recherche écoute d'abord les annonces que vos ampoules diffusent, puis, si rien n'arrive, frappe à chaque adresse du réseau. Comptez une vingtaine de secondes dans le pire cas. Elle trouve adresse et identifiant, mais jamais la clé : celle-ci reste à coller une fois par ampoule.",
        "de": "Die Suche hört zuerst auf die Ankündigungen Ihrer Lampen und klopft dann, falls nichts eintrifft, an jede Adresse im Netzwerk. Rechnen Sie im schlimmsten Fall mit rund zwanzig Sekunden. Sie findet Adresse und Kennung, aber nie den Schlüssel: den muss man weiterhin einmal pro Lampe einfügen.",
        "es": "La búsqueda escucha primero los anuncios que emiten sus bombillas y luego, si no llega nada, llama a cada dirección de la red. Cuente unos veinte segundos en el peor caso. Encuentra dirección e identificador, pero nunca la clave: esa hay que pegarla una vez por bombilla.",
        "it": "La ricerca ascolta prima gli annunci che le tue lampadine diffondono, poi, se non arriva nulla, bussa a ogni indirizzo della rete. Conta una ventina di secondi nel caso peggiore. Trova indirizzo e identificativo, ma mai la chiave: quella resta da incollare una volta per lampadina.",
        "ja": "検索はまず電球が発する通知を待ち受け、何も届かなければネットワーク上のすべてのアドレスに順に問い合わせます。最悪の場合で 20 秒ほどかかります。アドレスと識別子は見つかりますが、キーは決して見つかりません。キーは電球ごとに一度、手で貼り付ける必要があります。",
        "ko": "검색은 먼저 전구가 보내는 알림을 기다리고, 아무것도 오지 않으면 네트워크의 모든 주소를 차례로 두드립니다. 최악의 경우 20초쯤 걸립니다. 주소와 식별자는 찾지만 키는 결코 찾지 못합니다. 키는 전구마다 한 번씩 직접 붙여 넣어야 합니다.",
        "zh_CN": "搜索会先监听灯泡自己广播的通告；若没有回应，再逐个敲击网络上的每个地址。最坏情况约需二十秒。它能找到地址和标识符，但永远找不到密钥：密钥仍需为每只灯泡手动粘贴一次。",
        "zh_TW": "搜尋會先監聽燈泡自己廣播的通告；若沒有回應，再逐一敲擊網路上的每個位址。最壞情況約需二十秒。它能找到位址和識別碼，但永遠找不到金鑰：金鑰仍需為每顆燈泡手動貼上一次。",
    },
    "pi.field.id": {
        "en": "Bulb identifier", "fr": "Identifiant de l'ampoule", "de": "Lampen-Kennung",
        "es": "Identificador de la bombilla", "it": "Identificativo della lampadina",
        "ja": "電球の識別子", "ko": "전구 식별자", "zh_CN": "灯泡标识符", "zh_TW": "燈泡識別碼",
    },
    "pi.field.name": {
        "en": "Name (optional) — e.g. Desk", "fr": "Nom (facultatif) — ex. Bureau",
        "de": "Name (optional) — z. B. Schreibtisch", "es": "Nombre (opcional) — p. ej. Escritorio",
        "it": "Nome (facoltativo) — es. Scrivania",
        "ja": "名前（任意）— 例：デスク", "ko": "이름(선택) — 예: 책상",
        "zh_CN": "名称（可选）— 例如：书桌", "zh_TW": "名稱（選填）— 例如：書桌",
    },
    "pi.field.key": {
        "en": "Local key", "fr": "Clé locale", "de": "Lokaler Schlüssel", "es": "Clave local",
        "it": "Chiave locale", "ja": "ローカルキー", "ko": "로컬 키",
        "zh_CN": "本地密钥", "zh_TW": "本機金鑰",
    },
    "pi.field.keyKept": {
        "en": "Leave empty to keep the key", "fr": "Clé inchangée si vide",
        "de": "Leer lassen, um den Schlüssel zu behalten", "es": "Dejar vacío para conservar la clave",
        "it": "Lascia vuoto per mantenere la chiave",
        "ja": "空欄なら既存のキーを保持", "ko": "비워 두면 기존 키 유지",
        "zh_CN": "留空则保留原密钥", "zh_TW": "留空則保留原金鑰",
    },
    "pi.found.already": {
        "en": "already saved", "fr": "déjà enregistrée", "de": "bereits gespeichert",
        "es": "ya guardada", "it": "già salvata",
        "ja": "登録済み", "ko": "이미 등록됨", "zh_CN": "已登记", "zh_TW": "已登記",
    },
    "pi.found.device": {
        "en": "Tuya device at", "fr": "Appareil Tuya à", "de": "Tuya-Gerät an",
        "es": "Dispositivo Tuya en", "it": "Dispositivo Tuya a",
        "ja": "Tuya 機器", "ko": "Tuya 기기", "zh_CN": "Tuya 设备", "zh_TW": "Tuya 裝置",
    },
    "pi.found.noId": {
        "en": "unknown identifier", "fr": "identifiant inconnu", "de": "Kennung unbekannt",
        "es": "identificador desconocido", "it": "identificativo sconosciuto",
        "ja": "識別子は不明", "ko": "식별자 알 수 없음",
        "zh_CN": "标识符未知", "zh_TW": "識別碼未知",
    },
    "pi.save.button": {
        "en": "Save", "fr": "Enregistrer", "de": "Speichern", "es": "Guardar", "it": "Salva",
        "ja": "保存", "ko": "저장", "zh_CN": "保存", "zh_TW": "儲存",
    },
    "pi.save.missingId": {
        "en": "This bulb's identifier is missing.", "fr": "Il manque l'identifiant de cette ampoule.",
        "de": "Die Kennung dieser Lampe fehlt.", "es": "Falta el identificador de esta bombilla.",
        "it": "Manca l'identificativo di questa lampadina.",
        "ja": "この電球の識別子がありません。", "ko": "이 전구의 식별자가 없습니다.",
        "zh_CN": "缺少这只灯泡的标识符。", "zh_TW": "缺少這顆燈泡的識別碼。",
    },
    "pi.scan.button": {
        "en": "Search the network", "fr": "Chercher sur le réseau", "de": "Netzwerk durchsuchen",
        "es": "Buscar en la red", "it": "Cerca nella rete",
        "ja": "ネットワークを検索", "ko": "네트워크 검색",
        "zh_CN": "搜索网络", "zh_TW": "搜尋網路",
    },
    "pi.scan.running": {
        "en": "Searching…", "fr": "Recherche en cours…", "de": "Suche läuft…",
        "es": "Buscando…", "it": "Ricerca in corso…",
        "ja": "検索中…", "ko": "검색 중…", "zh_CN": "正在搜索…", "zh_TW": "正在搜尋…",
    },
    "pi.scan.none": {
        "en": "No device found. Check that the bulb is powered and on the same network as this computer.",
        "fr": "Aucun appareil trouvé. Vérifiez que l'ampoule est alimentée et sur le même réseau que cet ordinateur.",
        "de": "Kein Gerät gefunden. Prüfen Sie, ob die Lampe mit Strom versorgt ist und im selben Netzwerk wie dieser Rechner hängt.",
        "es": "No se encontró ningún dispositivo. Compruebe que la bombilla tiene corriente y está en la misma red que este ordenador.",
        "it": "Nessun dispositivo trovato. Verifica che la lampadina sia alimentata e sulla stessa rete di questo computer.",
        "ja": "機器が見つかりませんでした。電球に電源が入っていて、このコンピューターと同じネットワークにあるか確認してください。",
        "ko": "기기를 찾지 못했습니다. 전구에 전원이 들어와 있고 이 컴퓨터와 같은 네트워크에 있는지 확인하세요.",
        "zh_CN": "未找到设备。请确认灯泡已通电，并与这台电脑处于同一网络。",
        "zh_TW": "找不到裝置。請確認燈泡已通電，並與這台電腦位於同一網路。",
    },
    "pi.scan.found": {
        "en": "device(s) found", "fr": "appareil(s) trouvé(s)", "de": "Gerät(e) gefunden",
        "es": "dispositivo(s) encontrado(s)", "it": "dispositivo/i trovato/i",
        "ja": "台の機器が見つかりました", "ko": "대의 기기를 찾았습니다",
        "zh_CN": "个设备已找到", "zh_TW": "個裝置已找到",
    },
    "pi.scan.sweep": {
        "en": " (found by sweeping the network: your bulbs do not broadcast this far, which is common between a wired computer and a Wi-Fi bulb)",
        "fr": " (trouvé par balayage du réseau : vos ampoules ne diffusent pas jusqu'ici, c'est fréquent entre un ordinateur filaire et une ampoule en wifi)",
        "de": " (per Netzwerk-Scan gefunden: Ihre Lampen senden nicht bis hierher, häufig zwischen einem kabelgebundenen Rechner und einer WLAN-Lampe)",
        "es": " (encontrado por barrido de red: sus bombillas no difunden hasta aquí, algo frecuente entre un ordenador por cable y una bombilla wifi)",
        "it": " (trovato tramite scansione della rete: le tue lampadine non trasmettono fin qui, frequente tra un computer via cavo e una lampadina wifi)",
        "ja": "（ネットワーク走査で発見：電球の通知がここまで届いていません。有線のコンピューターと Wi-Fi の電球の組み合わせでよくあることです）",
        "ko": "(네트워크 훑기로 발견: 전구의 알림이 여기까지 닿지 않습니다. 유선 컴퓨터와 Wi-Fi 전구 조합에서 흔한 일입니다)",
        "zh_CN": "（通过扫描网络找到：灯泡的广播没有传到这里，有线电脑与 Wi-Fi 灯泡之间很常见）",
        "zh_TW": "（透過掃描網路找到：燈泡的廣播沒有傳到這裡，有線電腦與 Wi-Fi 燈泡之間很常見）",
    },
    "pi.save.ok": {
        "en": "Bulb saved. Choose it in the list above.",
        "fr": "Ampoule enregistrée. Choisissez-la dans la liste ci-dessus.",
        "de": "Lampe gespeichert. Wählen Sie sie in der Liste oben aus.",
        "es": "Bombilla guardada. Elígela en la lista de arriba.",
        "it": "Lampadina salvata. Scegliela nella lista qui sopra.",
        "ja": "電球を保存しました。上の一覧から選んでください。",
        "ko": "전구를 저장했습니다. 위 목록에서 선택하세요.",
        "zh_CN": "灯泡已保存。请在上面的列表中选择它。",
        "zh_TW": "燈泡已儲存。請在上面的清單中選擇它。",
    },
    "pi.save.failed": {
        "en": "Could not save.", "fr": "Échec de l'enregistrement.", "de": "Speichern fehlgeschlagen.",
        "es": "Error al guardar.", "it": "Salvataggio non riuscito.",
        "ja": "保存できませんでした。", "ko": "저장하지 못했습니다.",
        "zh_CN": "保存失败。", "zh_TW": "儲存失敗。",
    },
    "pi.save.needKey": {
        "en": "This bulb needs its local key to be controllable.",
        "fr": "Cette ampoule a besoin de sa clé locale pour être pilotable.",
        "de": "Diese Lampe braucht ihren lokalen Schlüssel, um steuerbar zu sein.",
        "es": "Esta bombilla necesita su clave local para poder controlarse.",
        "it": "Questa lampadina ha bisogno della sua chiave locale per essere controllabile.",
        "ja": "この電球を操作するにはローカルキーが必要です。",
        "ko": "이 전구를 제어하려면 로컬 키가 필요합니다.",
        "zh_CN": "这只灯泡需要本地密钥才能被控制。",
        "zh_TW": "這顆燈泡需要本機金鑰才能被控制。",
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
        print("  {:>5}  {} entrees  {}".format(langue, len(contenu), chemin.name))


if __name__ == "__main__":
    main()
