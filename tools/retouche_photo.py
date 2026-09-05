# -*- coding: utf-8 -*-
"""Retouche la photo du Stream Deck — seconde approche.

Premiere tentative, ecartee : relever les ombres. Le resultat virait au gris
laiteux et faisait ressortir le bruit du capteur ainsi que le moire des ecrans.
Elle detruisait ce qui faisait la force du cliche — un noir franc d'ou emergent
des touches lumineuses.

Approche retenue : ECRASER les noirs au lieu de les relever. Le bruit vit dans
les tons les plus sombres ; l'y renvoyer le supprime purement et simplement, et
le fond devient un noir profond qui met les touches en valeur. On ne recupere
rien du boitier, mais il n'y avait rien a en tirer.
"""
import numpy as np
from PIL import Image, ImageFilter, ImageEnhance

SRC = r'C:\Users\buton\Downloads\test.jpg'
OUT = r'C:\Users\buton\Documents\Projets\LumenDeck\promo\photo-deck.jpg'

im = Image.open(SRC).convert('RGB')
a = np.asarray(im).astype(np.float32) / 255.0

# --- Cadre serre sur les touches, ramene en 16:9 -----------------------------
lum = a.max(axis=2)
masque = lum > 0.30
# Bornes par DENSITE, pas par pixel isole : une source parasite hors du deck
# (ici un reflet orange en bas a droite) suffirait sinon a elargir le cadre et
# a decentrer la grille. On ne retient que les lignes et colonnes ou la matiere
# lumineuse represente au moins 8 % du maximum observe.
col = masque.sum(axis=0); lig = masque.sum(axis=1)
cols = np.where(col > col.max() * 0.08)[0]
ligs = np.where(lig > lig.max() * 0.08)[0]
kx0, kx1, ky0, ky1 = cols.min(), cols.max(), ligs.min(), ligs.max()
marge = int((kx1 - kx0) * 0.09)
x0 = max(0, kx0 - marge); x1 = min(a.shape[1], kx1 + marge)
y0 = max(0, ky0 - marge); y1 = min(a.shape[0], ky1 + marge)

# Completer en 16:9 autour du meme centre, sans sortir de l'image.
cx, cy = (x0 + x1) // 2, (y0 + y1) // 2
larg = x1 - x0
haut = int(larg * 9 / 16)
if haut < (y1 - y0):
    haut = y1 - y0
    larg = int(haut * 16 / 9)
x0 = max(0, cx - larg // 2); x1 = min(a.shape[1], x0 + larg)
y0 = max(0, cy - haut // 2); y1 = min(a.shape[0], y0 + haut)
a = a[y0:y1, x0:x1]
print('  cadre 16:9 : %dx%d' % (x1 - x0, y1 - y0))

# --- Effacer les sources hors sujet ------------------------------------------
# Une lampe hors champ laissait une tache orange en bas a droite, dans une zone
# ou il n'y a rien d'autre que du noir. La supprimer n'altere pas le sujet : ce
# n'est ni le deck ni l'ampoule, seulement un parasite du cadre.
bord = (kx1 - x0) + int((kx1 - kx0) * 0.03)
if bord < a.shape[1]:
    a[:, bord:] = 0.0
    print('  parasite efface a droite de x=%d' % bord)

# --- Noir ecrase, hautes lumieres preservees ---------------------------------
# 0.13 : releve empiriquement au-dessus du bruit de fond, sous le halo des
# touches. Au-dela, on commencait a ronger le contour des glyphes.
SEUIL = 0.13
a = np.clip((a - SEUIL) / (1.0 - SEUIL), 0, 1)
# Legere reprise des tons moyens, pour que les glyphes ne soient pas que du blanc.
a = np.power(a, 0.88)

img = Image.fromarray((a * 255).astype(np.uint8))
# Median 3 : attenue le moire des ecrans sans entamer les glyphes, qui sont larges.
img = img.filter(ImageFilter.MedianFilter(size=3))
img = ImageEnhance.Color(img).enhance(1.25)
img = ImageEnhance.Sharpness(img).enhance(1.35)

img.save(OUT, quality=93, subsampling=0)
print('  ecrit :', OUT, img.size)
