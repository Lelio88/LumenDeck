//! Capture de l'ecran par Desktop Duplication (DXGI), reduite sur le GPU.
//!
//! Ce que fait ce module : ouvrir un ecran, recevoir ses images, et rendre la
//! couleur de chaque zone sans jamais rapatrier l'image entiere sur le processeur.
//!
//! Choix non evidents :
//! - **Reduction par mipmaps sur le GPU** : chaque image recue est copiee dans une
//!   texture a chaine de mips ; `GenerateMips` la reduit (filtre en boite), et seul
//!   le plus petit niveau utile (~60 colonnes) est rapatrie. Lire une image 4K
//!   entiere coute ~33 Mo par image ; ici, quelques Ko.
//! - **La reduction n'est faite qu'a la demande** (`read`), pas a chaque image
//!   recue : on copie a la cadence de l'ecran (peu cher, GPU vers GPU), on reduit
//!   et lit a la cadence demandee (~15 par seconde).
//! - **Les images sans nouveau contenu sont ignorees** (`LastPresentTime == 0` : le
//!   curseur a bouge, rien d'autre).
//!
//! Invariants : toute image acquise est rendue a Windows (`ReleaseFrame`) meme si
//! sa copie echoue ; une perte d'acces (`ACCESS_LOST`, changement de mode
//! d'affichage) remonte comme une erreur, et l'appelant rouvre une session neuve.

use std::time::Duration;

use windows::core::{Interface, Result};
use windows::Win32::Foundation::{E_FAIL, HMODULE};
use windows::Win32::Graphics::Direct3D::D3D_DRIVER_TYPE_UNKNOWN;
use windows::Win32::Graphics::Direct3D11::*;
use windows::Win32::Graphics::Dxgi::Common::{DXGI_FORMAT_B8G8R8A8_UNORM, DXGI_SAMPLE_DESC};
use windows::Win32::Graphics::Dxgi::*;

use crate::zones::{analyze, Zone};

/// Largeur visee, en colonnes, du niveau de mip rapatrie.
const TARGET_COLUMNS: u32 = 64;

/// Quel ecran suivre.
#[derive(Debug, Clone, Copy)]
pub enum Selector {
    Primary,
    Index(u32),
}

/// Un ecran, tel que le panneau le propose.
pub struct ScreenInfo {
    pub index: u32,
    pub label: String,
    pub primary: bool,
}

/// Ce qu'un `poll` a trouve.
#[derive(Debug, PartialEq, Eq)]
pub enum Poll {
    /// Une image avec du contenu nouveau a ete copiee.
    Frame,
    /// Rien de neuf (ecran fixe, ou seul le curseur a bouge).
    Idle,
}

fn failure() -> windows::core::Error {
    windows::core::Error::from(E_FAIL)
}

/// Tous les ecrans de toutes les cartes graphiques, dans un ordre stable.
fn outputs() -> Result<Vec<(IDXGIAdapter1, IDXGIOutput)>> {
    // SAFETY: appels DXGI sans etat partage ; chaque objet COM est possede ici.
    unsafe {
        let factory: IDXGIFactory1 = CreateDXGIFactory1()?;
        let mut found = Vec::new();
        let mut a = 0;
        while let Ok(adapter) = factory.EnumAdapters1(a) {
            let mut o = 0;
            while let Ok(output) = adapter.EnumOutputs(o) {
                found.push((adapter.clone(), output));
                o += 1;
            }
            a += 1;
        }
        Ok(found)
    }
}

fn is_primary(output: &IDXGIOutput) -> Result<bool> {
    // SAFETY: lecture d'une description, sans effet de bord.
    let desc = unsafe { output.GetDesc()? };
    Ok(desc.DesktopCoordinates.left == 0 && desc.DesktopCoordinates.top == 0)
}

/// La liste des ecrans suivables.
pub fn list_screens() -> Result<Vec<ScreenInfo>> {
    let mut screens = Vec::new();
    for (index, (_, output)) in outputs()?.iter().enumerate() {
        // SAFETY: lecture d'une description, sans effet de bord.
        let desc = unsafe { output.GetDesc()? };
        let name_len = desc.DeviceName.iter().position(|&c| c == 0).unwrap_or(desc.DeviceName.len());
        let name = String::from_utf16_lossy(&desc.DeviceName[..name_len]);
        let rect = desc.DesktopCoordinates;
        screens.push(ScreenInfo {
            index: index as u32,
            label: format!("{} ({}x{})", name.trim_start_matches("\\\\.\\"), rect.right - rect.left, rect.bottom - rect.top),
            primary: is_primary(output)?,
        });
    }
    Ok(screens)
}

/// Texture de travail : l'image recue, sa chaine de mips, et de quoi lire le plus petit niveau.
struct MipChain {
    texture: ID3D11Texture2D,
    view: ID3D11ShaderResourceView,
    staging: ID3D11Texture2D,
    level: u32,
    width: u32,
    height: u32,
    source: (u32, u32),
}

pub struct Capturer {
    device: ID3D11Device,
    ctx: ID3D11DeviceContext,
    duplication: IDXGIOutputDuplication,
    chain: Option<MipChain>,
}

impl Capturer {
    pub fn open(selector: Selector) -> Result<Self> {
        let all = outputs()?;
        let chosen = match selector {
            Selector::Index(i) => all.into_iter().nth(i as usize),
            Selector::Primary => {
                let mut primary = None;
                for entry in all {
                    if is_primary(&entry.1)? {
                        primary = Some(entry);
                        break;
                    }
                }
                primary
            }
        };
        let (adapter, output) = chosen.ok_or_else(failure)?;

        // SAFETY: creation d'un peripherique Direct3D puis d'une duplication ; tout reste possede ici.
        unsafe {
            let mut device: Option<ID3D11Device> = None;
            let mut ctx: Option<ID3D11DeviceContext> = None;
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
            let output1: IDXGIOutput1 = output.cast()?;
            let duplication = output1.DuplicateOutput(&device)?;
            Ok(Capturer { device, ctx, duplication, chain: None })
        }
    }

    /// Attend une image au plus `timeout`. Copie son contenu dans la chaine de mips si elle est neuve.
    pub fn poll(&mut self, timeout: Duration) -> Result<Poll> {
        // SAFETY: AcquireNextFrame/ReleaseFrame vont par paire ; la ressource n'est pas gardee au-dela.
        unsafe {
            let mut info = DXGI_OUTDUPL_FRAME_INFO::default();
            let mut resource: Option<IDXGIResource> = None;
            match self.duplication.AcquireNextFrame(timeout.as_millis() as u32, &mut info, &mut resource) {
                Ok(()) => {}
                Err(e) if e.code() == DXGI_ERROR_WAIT_TIMEOUT => return Ok(Poll::Idle),
                Err(e) => return Err(e),
            }
            let copied = if info.LastPresentTime != 0 {
                resource.ok_or_else(failure).and_then(|r| self.copy_in(&r)).map(|()| Poll::Frame)
            } else {
                Ok(Poll::Idle)
            };
            self.duplication.ReleaseFrame()?;
            copied
        }
    }

    unsafe fn copy_in(&mut self, resource: &IDXGIResource) -> Result<()> {
        let frame: ID3D11Texture2D = resource.cast()?;
        let mut desc = D3D11_TEXTURE2D_DESC::default();
        frame.GetDesc(&mut desc);
        if desc.Format != DXGI_FORMAT_B8G8R8A8_UNORM {
            // HDR ou autre format : non gere pour l'instant, signale par une erreur franche.
            return Err(failure());
        }
        let size = (desc.Width, desc.Height);
        if self.chain.as_ref().map(|c| c.source) != Some(size) {
            self.chain = Some(self.build_chain(size)?);
        }
        let chain = self.chain.as_ref().ok_or_else(failure)?;
        self.ctx.CopySubresourceRegion(&chain.texture, 0, 0, 0, 0, &frame, 0, None);
        Ok(())
    }

    unsafe fn build_chain(&self, (width, height): (u32, u32)) -> Result<MipChain> {
        let mut level = 0;
        while (width.max(height) >> level) > TARGET_COLUMNS {
            level += 1;
        }
        let (small_w, small_h) = ((width >> level).max(1), (height >> level).max(1));

        let full = D3D11_TEXTURE2D_DESC {
            Width: width,
            Height: height,
            MipLevels: 0,
            ArraySize: 1,
            Format: DXGI_FORMAT_B8G8R8A8_UNORM,
            SampleDesc: DXGI_SAMPLE_DESC { Count: 1, Quality: 0 },
            Usage: D3D11_USAGE_DEFAULT,
            BindFlags: (D3D11_BIND_SHADER_RESOURCE.0 | D3D11_BIND_RENDER_TARGET.0) as u32,
            CPUAccessFlags: 0,
            MiscFlags: D3D11_RESOURCE_MISC_GENERATE_MIPS.0 as u32,
        };
        let mut texture: Option<ID3D11Texture2D> = None;
        self.device.CreateTexture2D(&full, None, Some(&mut texture))?;
        let texture: ID3D11Texture2D = texture.ok_or_else(failure)?;

        let mut view: Option<ID3D11ShaderResourceView> = None;
        self.device.CreateShaderResourceView(&texture, None, Some(&mut view))?;
        let view: ID3D11ShaderResourceView = view.ok_or_else(failure)?;

        let readback = D3D11_TEXTURE2D_DESC {
            Width: small_w,
            Height: small_h,
            MipLevels: 1,
            ArraySize: 1,
            Format: DXGI_FORMAT_B8G8R8A8_UNORM,
            SampleDesc: DXGI_SAMPLE_DESC { Count: 1, Quality: 0 },
            Usage: D3D11_USAGE_STAGING,
            BindFlags: 0,
            CPUAccessFlags: D3D11_CPU_ACCESS_READ.0 as u32,
            MiscFlags: 0,
        };
        let mut staging: Option<ID3D11Texture2D> = None;
        self.device.CreateTexture2D(&readback, None, Some(&mut staging))?;
        let staging: ID3D11Texture2D = staging.ok_or_else(failure)?;

        Ok(MipChain { texture, view, staging, level, width: small_w, height: small_h, source: (width, height) })
    }

    /// Reduit la derniere image copiee et mesure `zones` zones. Echoue si aucune image n'a encore ete recue.
    pub fn read(&mut self, zones: usize) -> Result<Vec<Zone>> {
        let chain = self.chain.as_ref().ok_or_else(failure)?;
        // SAFETY: la texture de lecture est mappee puis demappee dans cette fonction ; la tranche
        // d'octets lue ne depasse pas `pitch * height`, taille garantie par Direct3D pour ce mappage.
        unsafe {
            self.ctx.GenerateMips(&chain.view);
            self.ctx.CopySubresourceRegion(&chain.staging, 0, 0, 0, 0, &chain.texture, chain.level, None);
            let mut mapped = D3D11_MAPPED_SUBRESOURCE::default();
            self.ctx.Map(&chain.staging, 0, D3D11_MAP_READ, 0, Some(&mut mapped))?;
            let pitch = mapped.RowPitch as usize;
            // La derniere ligne n'a pas de remplissage garanti : on ne lit que ses pixels utiles.
            let len = pitch * (chain.height as usize - 1) + chain.width as usize * 4;
            let bytes = std::slice::from_raw_parts(mapped.pData as *const u8, len);
            let measured = analyze(bytes, chain.width as usize, chain.height as usize, pitch, zones);
            self.ctx.Unmap(&chain.staging, 0);
            Ok(measured)
        }
    }
}
