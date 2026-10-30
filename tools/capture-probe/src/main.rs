//! Sonde de capture d'écran — étape 0 de la synchro écran de LumenDeck.
//!
//! Répond à une seule question : pour CE jeu, la capture DXGI (Desktop Duplication) voit-elle
//! l'image, ou renvoie-t-elle du noir ? Elle ne pilote aucune ampoule.
//!
//! Choix non évidents :
//! - **Journal dans un fichier** (`capture-probe.log`, dans le dossier de lancement) : en plein
//!   écran exclusif la console est cachée, on lit le résultat après la partie.
//! - **Un seul adaptateur** (le premier) : suffit à la sonde ; un écran branché sur une autre
//!   carte graphique n'est pas géré.
//! - **Pas d'analyse à chaque image** : une par seconde, sur une grille clairsemée, pour ne pas
//!   peser sur le jeu que l'on mesure.
//!
//! Invariants : la sonde ne modifie rien (lecture seule) et relance la capture à chaque
//! `ACCESS_LOST` (changement de mode d'affichage, entrée en plein écran exclusif).
//!
//! Usage : `capture-probe.exe [index_ecran]` (0 par défaut) ; Ctrl+C pour finir.
//! Lignes : `IMAGE_OK` (couleur lue), `NOIR` (capture aveugle), `AUCUNE_IMAGE` (rien n'est
//! présenté à la capture), `ACCES_PERDU` (la capture a sauté puis repart), `FORMAT` (HDR ?).

use std::fs::{File, OpenOptions};
use std::io::Write;
use std::time::{Duration, Instant};

use windows::core::{Interface, Result};
use windows::Win32::Foundation::{E_FAIL, HMODULE};
use windows::Win32::Graphics::Direct3D::D3D_DRIVER_TYPE_UNKNOWN;
use windows::Win32::Graphics::Direct3D11::*;
use windows::Win32::Graphics::Dxgi::Common::{DXGI_FORMAT, DXGI_FORMAT_B8G8R8A8_UNORM};
use windows::Win32::Graphics::Dxgi::*;
use windows::Win32::System::Console::SetConsoleOutputCP;
use windows::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowTextW};

const REPORT_EVERY: Duration = Duration::from_secs(1);
const ACQUIRE_TIMEOUT_MS: u32 = 100;
const RETRY_DELAY: Duration = Duration::from_millis(500);
const SAMPLE_STEP: usize = 8;
/// En dessous, un canal est considéré éteint : tout l'écran sous ce seuil = capture noire.
const BLACK_THRESHOLD: u8 = 8;

struct Session {
    device: ID3D11Device,
    ctx: ID3D11DeviceContext,
    dupl: IDXGIOutputDuplication,
}

enum Verdict {
    Black,
    Color { r: u8, g: u8, b: u8 },
    Unsupported(DXGI_FORMAT),
}

struct Log {
    file: File,
    start: Instant,
}

impl Log {
    fn line(&mut self, msg: &str) {
        let line = format!("t+{:04}s  {} | {}", self.start.elapsed().as_secs(), msg, foreground_title());
        println!("{line}");
        let _ = writeln!(self.file, "{line}");
        let _ = self.file.flush();
    }
}

fn foreground_title() -> String {
    let mut buf = [0u16; 128];
    // SAFETY: appel Win32 simple ; buf reste valide pendant l'appel.
    let len = unsafe { GetWindowTextW(GetForegroundWindow(), &mut buf) };
    String::from_utf16_lossy(&buf[..len.max(0) as usize])
}

fn failure() -> windows::core::Error {
    windows::core::Error::from(E_FAIL)
}

/// Ouvre la duplication de l'écran `screen` de l'adaptateur 0.
unsafe fn open_session(screen: u32) -> Result<Session> {
    let factory: IDXGIFactory1 = CreateDXGIFactory1()?;
    let adapter = factory.EnumAdapters1(0)?;
    let output1: IDXGIOutput1 = adapter.EnumOutputs(screen)?.cast()?;
    let (mut device, mut ctx) = (None, None);
    D3D11CreateDevice(
        &adapter,
        D3D_DRIVER_TYPE_UNKNOWN,
        HMODULE::default(),
        D3D11_CREATE_DEVICE_BGRA_SUPPORT,
        None,
        D3D11_SDK_VERSION,
        Some(&mut device),
        None,
        Some(&mut ctx),
    )?;
    let device: ID3D11Device = device.ok_or_else(failure)?;
    let ctx: ID3D11DeviceContext = ctx.ok_or_else(failure)?;
    let dupl = output1.DuplicateOutput(&device)?;
    Ok(Session { device, ctx, dupl })
}

/// Copie l'image du GPU vers le CPU puis en tire un verdict sur une grille clairsemée.
unsafe fn analyze(s: &Session, resource: &IDXGIResource) -> Result<Verdict> {
    let tex: ID3D11Texture2D = resource.cast()?;
    let mut desc = D3D11_TEXTURE2D_DESC::default();
    tex.GetDesc(&mut desc);
    if desc.Format != DXGI_FORMAT_B8G8R8A8_UNORM {
        return Ok(Verdict::Unsupported(desc.Format));
    }
    desc.Usage = D3D11_USAGE_STAGING;
    desc.BindFlags = 0;
    desc.CPUAccessFlags = D3D11_CPU_ACCESS_READ.0 as u32;
    desc.MiscFlags = 0;
    let mut staging = None;
    s.device.CreateTexture2D(&desc, None, Some(&mut staging))?;
    let staging: ID3D11Texture2D = staging.ok_or_else(failure)?;
    s.ctx.CopyResource(&staging, &tex);

    let mut mapped = D3D11_MAPPED_SUBRESOURCE::default();
    s.ctx.Map(&staging, 0, D3D11_MAP_READ, 0, Some(&mut mapped))?;
    let (pitch, width, height) = (mapped.RowPitch as usize, desc.Width as usize, desc.Height as usize);
    let verdict = read_grid(mapped.pData as *const u8, pitch, width, height);
    s.ctx.Unmap(&staging, 0);
    Ok(verdict)
}

/// Moyenne pondérée par la saturation (évite le marron terne d'une moyenne simple).
unsafe fn read_grid(data: *const u8, pitch: usize, width: usize, height: usize) -> Verdict {
    let (mut sum_r, mut sum_g, mut sum_b, mut weight) = (0f64, 0f64, 0f64, 0f64);
    let mut brightest = 0u8;
    for y in (0..height).step_by(SAMPLE_STEP) {
        let row = data.add(y * pitch);
        for x in (0..width).step_by(SAMPLE_STEP) {
            let px = row.add(x * 4);
            let (b, g, r) = (*px, *px.add(1), *px.add(2));
            let max = r.max(g).max(b);
            brightest = brightest.max(max);
            let w = f64::from(max - r.min(g).min(b)) + 1.0;
            sum_r += f64::from(r) * w;
            sum_g += f64::from(g) * w;
            sum_b += f64::from(b) * w;
            weight += w;
        }
    }
    if brightest <= BLACK_THRESHOLD {
        return Verdict::Black;
    }
    Verdict::Color { r: (sum_r / weight) as u8, g: (sum_g / weight) as u8, b: (sum_b / weight) as u8 }
}

fn describe(verdict: &Verdict, presented: u32) -> String {
    match verdict {
        Verdict::Black => format!("NOIR (images={presented})"),
        Verdict::Color { r, g, b } => format!("IMAGE_OK #{r:02x}{g:02x}{b:02x} (images={presented})"),
        Verdict::Unsupported(f) => format!("FORMAT {f:?} (HDR ?) images={presented}"),
    }
}

/// Boucle de capture ; ne rend la main que sur erreur (typiquement `ACCESS_LOST`).
unsafe fn run_session(s: &Session, log: &mut Log) -> Result<()> {
    let mut window_start = Instant::now();
    let mut presented = 0u32;
    loop {
        let mut info = DXGI_OUTDUPL_FRAME_INFO::default();
        let mut resource: Option<IDXGIResource> = None;
        let due = window_start.elapsed() >= REPORT_EVERY;
        match s.dupl.AcquireNextFrame(ACQUIRE_TIMEOUT_MS, &mut info, &mut resource) {
            Ok(()) => {
                if info.LastPresentTime != 0 {
                    presented += 1;
                }
                let verdict = match (&resource, due) {
                    (Some(r), true) => Some(analyze(s, r)),
                    _ => None,
                };
                s.dupl.ReleaseFrame()?;
                if let Some(v) = verdict {
                    log.line(&describe(&v?, presented));
                    (window_start, presented) = (Instant::now(), 0);
                }
            }
            Err(e) if e.code() == DXGI_ERROR_WAIT_TIMEOUT => {
                if due {
                    log.line(&format!("AUCUNE_IMAGE (images={presented})"));
                    (window_start, presented) = (Instant::now(), 0);
                }
            }
            Err(e) => return Err(e),
        }
    }
}

fn main() {
    let screen: u32 = std::env::args().nth(1).and_then(|a| a.parse().ok()).unwrap_or(0);
    // SAFETY: appel Win32 sans état ; sert uniquement à l'affichage des accents.
    unsafe {
        let _ = SetConsoleOutputCP(65001);
    }
    let file = OpenOptions::new()
        .create(true)
        .append(true)
        .open("capture-probe.log")
        .expect("impossible d'ouvrir capture-probe.log");
    let mut log = Log { file, start: Instant::now() };
    println!("Sonde de capture — écran {screen}. Ctrl+C pour finir. Journal : capture-probe.log");
    loop {
        // SAFETY: tout l'accès COM reste dans ce thread, sur des objets créés ici.
        let outcome = unsafe { open_session(screen).and_then(|s| run_session(&s, &mut log)) };
        if let Err(e) = outcome {
            log.line(&format!("ACCES_PERDU ({})", e.message().trim()));
        }
        std::thread::sleep(RETRY_DELAY);
    }
}
