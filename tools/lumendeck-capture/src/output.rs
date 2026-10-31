//! Ce que le capteur ecrit : lignes JSON pour le plugin, lignes lisibles pour la sonde.
//!
//! Ce que fait ce module : mettre en forme la sortie, et rien d'autre.
//!
//! Choix non evident : deux formats pour un meme capteur. Le mode normal parle
//! JSON au plugin (une ligne par image, voir src/screen/zones.ts cote plugin) ; le
//! mode `--diagnose` ecrit des lignes lisibles et les range aussi dans un fichier,
//! car en plein ecran exclusif la console est cachee et l'on relit le resultat
//! apres la partie. C'est l'ancienne sonde de capture, devenue un mode du capteur
//! pour ne pas dupliquer le code Direct3D.
//!
//! Invariant : en mode normal, la sortie standard ne contient QUE des lignes JSON
//! completes ; tout le reste (erreurs, explications) part sur la sortie d'erreur.

use std::fs::{File, OpenOptions};
use std::io::Write;
use std::time::Instant;

use windows::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowTextW};

use crate::zones::Zone;

pub enum Sink {
    Json,
    Diagnose { file: File, start: Instant },
}

impl Sink {
    pub fn json() -> Self {
        Sink::Json
    }

    pub fn diagnose(path: &str) -> std::io::Result<Self> {
        let file = OpenOptions::new().create(true).append(true).open(path)?;
        Ok(Sink::Diagnose { file, start: Instant::now() })
    }

    /// Une mesure par zone. `presented` : images recues depuis la mesure precedente.
    pub fn zones(&mut self, zones: &[Zone], presented: u32) {
        match self {
            Sink::Json => {
                let items: Vec<String> = zones.iter().map(|z| format!("[{},{},{},{}]", z.r, z.g, z.b, z.v)).collect();
                emit(&format!("{{\"zones\":[{}]}}", items.join(",")));
            }
            Sink::Diagnose { .. } => {
                let z = zones.first().copied().unwrap_or(Zone::BLACK);
                let text = if z == Zone::BLACK {
                    format!("NOIR (images={presented})")
                } else {
                    format!("IMAGE_OK #{:02x}{:02x}{:02x} (images={presented})", z.r, z.g, z.b)
                };
                self.diagnose_line(&text);
            }
        }
        let _ = std::io::stdout().flush();
    }

    /// `ready` quand la capture est ouverte, `lost` quand elle saute.
    pub fn status(&mut self, status: &str) {
        match self {
            Sink::Json => emit(&format!("{{\"status\":\"{status}\"}}")),
            Sink::Diagnose { .. } => {
                let text = if status == "lost" { "ACCES_PERDU" } else { "PRET" };
                self.diagnose_line(text);
            }
        }
        let _ = std::io::stdout().flush();
    }

    /// Rien n'a ete presente a la capture pendant la derniere seconde (mode diagnostic seulement).
    pub fn idle(&mut self) {
        if matches!(self, Sink::Diagnose { .. }) {
            self.diagnose_line("AUCUNE_IMAGE (images=0)");
        }
    }

    fn diagnose_line(&mut self, text: &str) {
        if let Sink::Diagnose { file, start } = self {
            let line = format!("t+{:04}s  {} | {}", start.elapsed().as_secs(), text, foreground_title());
            emit(&line);
            let _ = writeln!(file, "{line}");
            let _ = file.flush();
        }
    }
}

/// Ecrit une ligne sur la sortie standard. Une sortie fermee (le plugin est parti) n'est pas
/// une erreur a signaler : `println!` y paniquerait, et le capteur s'arrete deja tout seul.
fn emit(line: &str) {
    let mut out = std::io::stdout().lock();
    let _ = writeln!(out, "{line}");
    let _ = out.flush();
}

fn foreground_title() -> String {
    let mut buf = [0u16; 128];
    // SAFETY: appel Win32 simple ; `buf` reste valide pendant l'appel.
    let len = unsafe { GetWindowTextW(GetForegroundWindow(), &mut buf) };
    String::from_utf16_lossy(&buf[..len.max(0) as usize])
}
