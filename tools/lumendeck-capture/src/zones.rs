//! Mesure de la couleur d'une image deja reduite, zone par zone.
//!
//! Ce que fait ce module : transformer une petite image BGRA (une soixantaine de
//! colonnes) en une couleur par zone d'ecran, de gauche a droite.
//!
//! Choix non evidents :
//! - **Moyenne ponderee par la saturation** : une moyenne simple d'une scene donne
//!   un marron terne ; les pixels vifs doivent peser plus que les gris.
//! - **Luminosite mesuree a part**, comme moyenne du canal le plus fort : la
//!   ponderation ci-dessus ignorerait justement les scenes sombres et ternes.
//! - **Bandes noires ecartees** : un film en 2,39:1 a un quart de son image en noir
//!   pur ; sans les ecarter, ses lampes resteraient ternes toute la projection.
//!   On borne la mesure a la zone ou il se passe quelque chose, lignes ET colonnes.
//!
//! Invariants : fonctions pures, sans acces au GPU (testables partout) ; sur une
//! image entierement noire, toutes les zones valent noir plutot que de diviser par zero.

/// Un canal sous ce seuil est considere eteint (bande noire, ecran noir).
const BLACK: u8 = 8;

/// Couleur mesuree d'une zone : RVB 0-255 et luminosite 0-100.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Zone {
    pub r: u8,
    pub g: u8,
    pub b: u8,
    pub v: u8,
}

impl Zone {
    pub const BLACK: Zone = Zone { r: 0, g: 0, b: 0, v: 0 };
}

/// Rectangle `[x0, x1[ x [y0, y1[` ou l'image n'est pas noire.
struct Area {
    x0: usize,
    x1: usize,
    y0: usize,
    y1: usize,
}

fn channels(pixels: &[u8], pitch: usize, x: usize, y: usize) -> (u8, u8, u8) {
    let i = y * pitch + x * 4;
    (pixels[i + 2], pixels[i + 1], pixels[i])
}

/// Une ligne ou colonne n'est « active » que si au moins 2 % de ses pixels ne sont pas noirs :
/// un logo de chaine, un sous-titre ou le curseur dans une bande noire ne doivent pas
/// annuler le recadrage a eux seuls.
fn is_active(lit: usize, length: usize) -> bool {
    lit > 0 && lit * 50 >= length
}

fn active_area(pixels: &[u8], width: usize, height: usize, pitch: usize) -> Option<Area> {
    let mut rows = vec![0usize; height];
    let mut cols = vec![0usize; width];
    for y in 0..height {
        for x in 0..width {
            let (r, g, b) = channels(pixels, pitch, x, y);
            if r.max(g).max(b) > BLACK {
                rows[y] += 1;
                cols[x] += 1;
            }
        }
    }
    let y0 = rows.iter().position(|&n| is_active(n, width))?;
    let y1 = rows.iter().rposition(|&n| is_active(n, width))? + 1;
    let x0 = cols.iter().position(|&n| is_active(n, height))?;
    let x1 = cols.iter().rposition(|&n| is_active(n, height))? + 1;
    Some(Area { x0, x1, y0, y1 })
}

fn measure(pixels: &[u8], pitch: usize, x0: usize, x1: usize, y0: usize, y1: usize) -> Zone {
    let (mut sum_r, mut sum_g, mut sum_b, mut weight) = (0f64, 0f64, 0f64, 0f64);
    let (mut sum_v, mut count) = (0f64, 0f64);
    for y in y0..y1 {
        for x in x0..x1 {
            let (r, g, b) = channels(pixels, pitch, x, y);
            let max = r.max(g).max(b);
            let w = f64::from(max - r.min(g).min(b)) + 1.0;
            sum_r += f64::from(r) * w;
            sum_g += f64::from(g) * w;
            sum_b += f64::from(b) * w;
            weight += w;
            sum_v += f64::from(max);
            count += 1.0;
        }
    }
    if count == 0.0 {
        return Zone::BLACK;
    }
    Zone {
        r: (sum_r / weight).round() as u8,
        g: (sum_g / weight).round() as u8,
        b: (sum_b / weight).round() as u8,
        v: (sum_v / count / 255.0 * 100.0).round() as u8,
    }
}

/// Mesure `zones` zones de gauche a droite sur une image BGRA de `width` x `height`
/// pixels, dont les lignes sont espacees de `pitch` octets.
pub fn analyze(pixels: &[u8], width: usize, height: usize, pitch: usize, zones: usize) -> Vec<Zone> {
    let zones = zones.max(1);
    let Some(area) = active_area(pixels, width, height, pitch) else {
        return vec![Zone::BLACK; zones];
    };
    let span = area.x1 - area.x0;
    (0..zones)
        .map(|z| {
            let from = area.x0 + z * span / zones;
            let to = (area.x0 + (z + 1) * span / zones).max(from + 1).min(area.x1);
            measure(pixels, pitch, from.min(area.x1 - 1), to, area.y0, area.y1)
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Image BGRA de `w` x `h` pixels dont chaque pixel vient de `f(x, y) -> (r, g, b)`.
    fn image(w: usize, h: usize, f: impl Fn(usize, usize) -> (u8, u8, u8)) -> Vec<u8> {
        let mut data = Vec::with_capacity(w * h * 4);
        for y in 0..h {
            for x in 0..w {
                let (r, g, b) = f(x, y);
                data.extend_from_slice(&[b, g, r, 255]);
            }
        }
        data
    }

    #[test]
    fn all_black_gives_black_zones() {
        let px = image(8, 4, |_, _| (0, 0, 0));
        assert_eq!(analyze(&px, 8, 4, 32, 2), vec![Zone::BLACK, Zone::BLACK]);
    }

    #[test]
    fn splits_left_and_right() {
        let px = image(8, 4, |x, _| if x < 4 { (200, 20, 20) } else { (20, 20, 200) });
        let zones = analyze(&px, 8, 4, 32, 2);
        assert!(zones[0].r > 150 && zones[0].b < 60, "gauche rouge : {:?}", zones[0]);
        assert!(zones[1].b > 150 && zones[1].r < 60, "droite bleue : {:?}", zones[1]);
    }

    #[test]
    fn letterbox_bars_do_not_dim_the_scene() {
        let with_bars = image(8, 8, |_, y| if (2..6).contains(&y) { (100, 100, 100) } else { (0, 0, 0) });
        let without = image(8, 4, |_, _| (100, 100, 100));
        let a = analyze(&with_bars, 8, 8, 32, 1)[0];
        let b = analyze(&without, 8, 4, 32, 1)[0];
        assert_eq!(a.v, b.v, "les bandes noires ne comptent pas dans la luminosite");
    }

    #[test]
    fn a_logo_in_the_black_bar_does_not_cancel_the_crop() {
        let with_logo = image(60, 8, |x, y| match (x, y) {
            (3, 0) => (200, 200, 200),
            (_, 2..=5) => (100, 100, 100),
            _ => (0, 0, 0),
        });
        let clean = image(60, 4, |_, _| (100, 100, 100));
        assert_eq!(analyze(&with_logo, 60, 8, 240, 1)[0].v, analyze(&clean, 60, 4, 240, 1)[0].v);
    }

    #[test]
    fn saturated_pixels_outweigh_grey_ones() {
        let px = image(8, 1, |x, _| if x == 0 { (255, 0, 0) } else { (128, 128, 128) });
        let z = analyze(&px, 8, 1, 32, 1)[0];
        assert!(z.r > z.g, "le rouge vif l'emporte sur le fond gris : {:?}", z);
    }

    #[test]
    fn respects_row_pitch_padding() {
        // Lignes de 4 pixels utiles mais espacees de 24 octets (8 d'alignement).
        let mut px = vec![0u8; 24 * 2];
        for y in 0..2 {
            for x in 0..4 {
                let i = y * 24 + x * 4;
                px[i..i + 4].copy_from_slice(&[0, 0, 200, 255]);
            }
        }
        let z = analyze(&px, 4, 2, 24, 1)[0];
        assert!(z.r > 190 && z.g < 10);
    }

    #[test]
    fn more_zones_than_columns_still_answers() {
        let px = image(2, 2, |_, _| (90, 90, 90));
        assert_eq!(analyze(&px, 2, 2, 8, 4).len(), 4);
    }
}
