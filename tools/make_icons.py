"""Genere toutes les icones du plugin LumenDeck.

Ce que fait ce script : produire les 12 PNG attendus par Stream Deck a partir
d'un dessin decrit en code. Les icones sont reproductibles et modifiables sans
logiciel de dessin, et on ne versionne pas des binaires opaques.

GRAMMAIRE VISUELLE, ET POURQUOI ELLE EST AINSI
Elle suit la convention d'Elgato, relevee sur leurs propres gabarits, parce que
c'est elle qui reste lisible dans cette interface :
  - faces de touche : fond plein carre quasi noir, un glyphe en trait epais,
    d'une seule couleur, largement entoure de vide. PAS de coins arrondis dans
    le PNG, Stream Deck arrondit lui-meme la touche ;
  - icones de liste : glyphe gris clair sur transparent, tres simple. L'interface
    Stream Deck est sombre, d'ou le glyphe clair ;
  - aucune lueur diffuse. Un premier jet en avait : le halo noyait le fond et les
    icones devenaient des carres orange plats. Le trait doit tout porter.
L'ecart assume avec Elgato est la couleur d'accent : ambre plutot que bleu,
parce que le sujet du plugin est la lumiere chaude.

Choix techniques non evidents :
  - Sur-echantillonnage x4 puis reduction Lanczos : Pillow n'anticrenele pas ses
    primitives, dessiner grand puis reduire est la seule facon d'obtenir des
    courbes propres a 20 px.
  - Le cadrage passe par la BOITE ENGLOBANTE du glyphe, pas par des coordonnees
    reglees a la main : on dessine, on recadre sur le contenu reel, puis on
    inscrit dans une boite de marge fixe. Ainsi tous les glyphes ont la meme
    respiration optique sans reprendre chaque proportion un par un.
  - Les extremites de trait sont completees par des disques : Pillow ne sait pas
    faire de terminaison arrondie, or un bout carre durcit le dessin.
  - Le glyphe est SIMPLIFIE en dessous de 32 px (filament, filets du culot et
    moyeu supprimes) : a cette taille ces details ne sont plus que du bruit.

Usage : py -3.11 tools/make_icons.py
"""
from __future__ import annotations

import math
import pathlib

from PIL import Image, ImageDraw

SS = 4  # facteur de sur-echantillonnage

# --- Palette ----------------------------------------------------------------
INK = (12, 15, 21)  # fond des faces de touche, quasi noir
AMBER = (255, 178, 71)  # accent : la lumiere, sujet du plugin
BONE = (201, 205, 212)  # gris des listes, cale sur celui d'Elgato

# Part de la largeur occupee par le glyphe. Le reste est de la marge.
CONTENT_KEY = 0.56
CONTENT_LIST = 0.64

# En dessous de ce seuil, on dessine la version simplifiee du glyphe.
DETAIL_THRESHOLD = 32

ROOT = pathlib.Path(__file__).resolve().parent.parent / "com.lumendeck.bulb.sdPlugin" / "imgs"


def canvas(size: int, bg=(0, 0, 0, 0)) -> Image.Image:
    return Image.new("RGBA", (size, size), bg)


def cap(d: ImageDraw.ImageDraw, x: float, y: float, w: float, fill) -> None:
    """Disque de terminaison : adoucit un bout de trait carre."""
    r = w / 2
    d.ellipse([x - r, y - r, x + r, y + r], fill=fill)


def stroke(d: ImageDraw.ImageDraw, points, w: float, fill) -> None:
    """Polyligne a terminaisons et jointures arrondies."""
    d.line(points, fill=fill, width=max(1, int(round(w))), joint="curve")
    for x, y in points:
        cap(d, x, y, w, fill)


# --- Glyphes ----------------------------------------------------------------
# Dessines dans un carre de reference ; le cadrage final est fait par fit().


def glyph_bulb(d: ImageDraw.ImageDraw, s: int, color, detailed: bool) -> None:
    """Ampoule en trait : un globe, un col, un culot."""
    w = s * 0.082
    cx, cy, r = s * 0.5, s * 0.40, s * 0.235

    d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=color, width=max(1, int(round(w))))

    neck = s * 0.100
    stroke(d, [(cx - neck, s * 0.590), (cx - neck, s * 0.660)], w, color)
    stroke(d, [(cx + neck, s * 0.590), (cx + neck, s * 0.660)], w, color)

    base = s * 0.094
    rows = (s * 0.715, s * 0.800) if detailed else (s * 0.740,)
    for y in rows:
        stroke(d, [(cx - base, y), (cx + base, y)], w, color)

    if detailed:
        # Filament : une onde discrete, signature du plugin. Supprimee en petit,
        # ou elle se refermerait en tache.
        span = s * 0.090
        stroke(
            d,
            [
                (cx - span, cy + s * 0.038),
                (cx - span * 0.33, cy - s * 0.058),
                (cx + span * 0.33, cy + s * 0.058),
                (cx + span, cy - s * 0.038),
            ],
            s * 0.056,
            color,
        )


def glyph_gauge(d: ImageDraw.ImageDraw, s: int, color, detailed: bool) -> None:
    """Jauge : un arc ouvert en bas, une aiguille courte, un moyeu.

    L'ouverture basse et l'aiguille sont ce qui distingue une JAUGE d'un anneau.
    L'aiguille est volontairement COURTE : un premier jet la faisait courir
    jusqu'a l'arc, ou sa pointe fusionnait avec la terminaison droite et
    l'ensemble se lisait comme un omega.
    """
    w = s * 0.088
    cx, cy, r = s * 0.5, s * 0.5, s * 0.30
    box = [cx - r, cy - r, cx + r, cy + r]

    d.arc(box, start=140, end=400, fill=color, width=max(1, int(round(w))))
    for angle in (140, 40):
        a = math.radians(angle)
        cap(d, cx + r * math.cos(a), cy + r * math.sin(a), w, color)

    a = math.radians(-58)
    stroke(d, [(cx, cy), (cx + r * 0.46 * math.cos(a), cy + r * 0.46 * math.sin(a))], w * 0.9, color)

    if detailed:
        hr = s * 0.058
        d.ellipse([cx - hr, cy - hr, cx + hr, cy + hr], fill=color)


# --- Fabrication ------------------------------------------------------------


def fit(layer: Image.Image, size: int, content: float) -> Image.Image:
    """Recadre sur le contenu reel, puis inscrit dans une boite de marge fixe.

    C'est ce qui garantit la meme respiration a tous les glyphes, quels que
    soient leurs debordements propres.
    """
    bbox = layer.getbbox()
    if bbox is None:
        return layer.resize((size, size), Image.Resampling.LANCZOS)
    cropped = layer.crop(bbox)

    target = size * SS * content
    scale = min(target / cropped.width, target / cropped.height)
    new = (max(1, round(cropped.width * scale)), max(1, round(cropped.height * scale)))
    cropped = cropped.resize(new, Image.Resampling.LANCZOS)

    out = canvas(size * SS)
    out.alpha_composite(cropped, ((size * SS - new[0]) // 2, (size * SS - new[1]) // 2))
    return out.resize((size, size), Image.Resampling.LANCZOS)


def key_face(size: int, glyph) -> Image.Image:
    """Face de touche : carre plein quasi noir, glyphe ambre centre."""
    s = size * SS
    layer = canvas(s)
    glyph(ImageDraw.Draw(layer), s, AMBER + (255,), size >= DETAIL_THRESHOLD)
    img = canvas(size, INK + (255,))
    img.alpha_composite(fit(layer, size, CONTENT_KEY))
    return img


def list_icon(size: int, glyph) -> Image.Image:
    """Silhouette claire sur transparent, pour les listes de l'interface."""
    s = size * SS
    layer = canvas(s)
    glyph(ImageDraw.Draw(layer), s, BONE + (255,), size >= DETAIL_THRESHOLD)
    return fit(layer, size, CONTENT_LIST)


def write(img: Image.Image, *parts: str) -> None:
    path = ROOT.joinpath(*parts)
    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path, "PNG")
    print("  {:>3}x{:<3}  {}".format(img.size[0], img.size[1], path.relative_to(ROOT)))


def main() -> None:
    print("Icones LumenDeck")
    for size, suffix in ((288, ""), (512, "@2x")):
        write(key_face(size, glyph_bulb), "plugin", "marketplace{}.png".format(suffix))
    for size, suffix in ((28, ""), (56, "@2x")):
        write(list_icon(size, glyph_bulb), "plugin", "category-icon{}.png".format(suffix))
    for size, suffix in ((20, ""), (40, "@2x")):
        write(list_icon(size, glyph_bulb), "actions", "toggle", "icon{}.png".format(suffix))
        write(list_icon(size, glyph_gauge), "actions", "brightness", "icon{}.png".format(suffix))
    for size, suffix in ((72, ""), (144, "@2x")):
        write(key_face(size, glyph_bulb), "actions", "toggle", "key{}.png".format(suffix))
        write(key_face(size, glyph_gauge), "actions", "brightness", "key{}.png".format(suffix))


if __name__ == "__main__":
    main()
