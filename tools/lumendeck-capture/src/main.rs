//! Capteur d'ecran de LumenDeck : mesure la couleur de l'ecran, zone par zone.
//!
//! Lance par le plugin Stream Deck, il ecrit une ligne JSON par mesure sur sa
//! sortie standard et ne sait RIEN des ampoules : il mesure vite, le plugin
//! decide de la couleur a envoyer (lissage, saturation, repartition des lampes).
//!
//! Choix non evidents :
//! - **Il s'arrete quand son entree se ferme.** Si le plugin meurt sans nettoyer,
//!   le capteur ne reste pas a lire l'ecran pour personne.
//! - **Il rouvre la capture tout seul** apres une perte d'acces (changement de
//!   resolution, entree dans un jeu en plein ecran) : le plugin n'a qu'a lire.
//! - **`--diagnose`** reprend la sonde de capture : une ligne lisible par seconde,
//!   rangee aussi dans `capture-probe.log`, pour savoir si un jeu est visible.
//!
//! Usage :
//!   lumendeck-capture --screen primary --zones 2 --fps 30     (mode plugin)
//!   lumendeck-capture --list                                  (JSON des ecrans)
//!   lumendeck-capture --diagnose [--screen N]                 (sonde, Ctrl+C pour finir)

mod capture;
mod output;
mod zones;

use std::io::Read;
use std::time::{Duration, Instant};

use capture::{Capturer, Poll, Selector};
use output::Sink;

const POLL_TIMEOUT: Duration = Duration::from_millis(100);
const RETRY_DELAY: Duration = Duration::from_millis(500);
const DEFAULT_FPS: u64 = 15;
const MAX_FPS: u64 = 60;
const MAX_ZONES: usize = 4;
const DIAGNOSE_LOG: &str = "capture-probe.log";

struct Config {
    selector: Selector,
    zones: usize,
    fps: u64,
    list: bool,
    diagnose: bool,
}

fn parse_args() -> Config {
    let mut config = Config { selector: Selector::Primary, zones: 1, fps: DEFAULT_FPS, list: false, diagnose: false };
    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--list" => config.list = true,
            "--diagnose" => config.diagnose = true,
            "--screen" => {
                config.selector = match args.next().as_deref() {
                    Some("primary") | None => Selector::Primary,
                    Some(n) => n.parse().map(Selector::Index).unwrap_or(Selector::Primary),
                };
            }
            "--zones" => config.zones = args.next().and_then(|n| n.parse().ok()).unwrap_or(1usize).clamp(1, MAX_ZONES),
            "--fps" => config.fps = args.next().and_then(|n| n.parse().ok()).unwrap_or(DEFAULT_FPS).clamp(1, MAX_FPS),
            _ => {}
        }
    }
    config
}

fn print_screens() {
    match capture::list_screens() {
        Ok(screens) => {
            let items: Vec<String> = screens
                .iter()
                .map(|s| format!("{{\"index\":{},\"label\":{:?},\"primary\":{}}}", s.index, s.label, s.primary))
                .collect();
            println!("[{}]", items.join(","));  // mode ponctuel : la sortie reste ouverte
        }
        Err(e) => {
            eprintln!("liste des ecrans impossible : {}", e.message());
            println!("[]");
        }
    }
}

/// Une session de capture, de l'ouverture a la premiere erreur (typiquement `ACCESS_LOST`).
fn session(config: &Config, sink: &mut Sink) -> windows::core::Result<()> {
    let mut capturer = Capturer::open(config.selector)?;
    sink.status("ready");

    let interval = Duration::from_millis(1000 / config.fps);
    let mut last = Instant::now();
    let (mut presented, mut dirty) = (0u32, false);
    loop {
        if capturer.poll(POLL_TIMEOUT)? == Poll::Frame {
            presented += 1;
            dirty = true;
        }
        if last.elapsed() < interval {
            continue;
        }
        last = Instant::now();
        if dirty {
            sink.zones(&capturer.read(config.zones)?, presented);
            (presented, dirty) = (0, false);
        } else {
            sink.idle();
        }
    }
}

/// Quitte des que l'entree standard se ferme : le plugin n'est plus la.
fn exit_when_stdin_closes() {
    std::thread::spawn(|| {
        let mut sink = [0u8; 64];
        let mut stdin = std::io::stdin();
        while matches!(stdin.read(&mut sink), Ok(n) if n > 0) {}
        std::process::exit(0);
    });
}

fn main() {
    let config = parse_args();
    if config.list {
        print_screens();
        return;
    }

    let mut sink = if config.diagnose {
        match Sink::diagnose(DIAGNOSE_LOG) {
            Ok(sink) => sink,
            Err(e) => {
                eprintln!("impossible d'ouvrir {DIAGNOSE_LOG} : {e}");
                return;
            }
        }
    } else {
        exit_when_stdin_closes();
        Sink::json()
    };
    // En diagnostic, une mesure par seconde suffit et rend le journal lisible.
    let config = if config.diagnose { Config { fps: 1, zones: 1, ..config } } else { config };

    loop {
        if let Err(e) = session(&config, &mut sink) {
            eprintln!("capture interrompue : {}", e.message());
            sink.status("lost");
        }
        std::thread::sleep(RETRY_DELAY);
    }
}
