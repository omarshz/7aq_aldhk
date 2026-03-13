use base64::Engine;
use image::codecs::jpeg::JpegEncoder;
use std::io::Cursor;
use std::sync::Mutex;
use tauri::AppHandle;

/// Simple perceptual hash: downsample to 8x8 grayscale, compare to mean.
/// Returns a 64-bit hash for fast screen-change detection.
fn perceptual_hash(img: &image::RgbaImage) -> u64 {
    let small = image::imageops::resize(img, 8, 8, image::imageops::FilterType::Nearest);
    let grays: Vec<u8> = small
        .pixels()
        .map(|p| ((p[0] as u16 + p[1] as u16 + p[2] as u16) / 3) as u8)
        .collect();
    let mean: u8 = (grays.iter().map(|&g| g as u32).sum::<u32>() / grays.len() as u32) as u8;
    let mut hash: u64 = 0;
    for (i, &g) in grays.iter().enumerate() {
        if g > mean {
            hash |= 1 << i;
        }
    }
    hash
}

/// Hamming distance between two perceptual hashes.
fn hash_distance(a: u64, b: u64) -> u32 {
    (a ^ b).count_ones()
}

/// Cached screenshot state for skipping duplicate LLM calls.
struct ScreenCache {
    last_hash: u64,
    last_b64: String,
}

static SCREEN_CACHE: Mutex<Option<ScreenCache>> = Mutex::new(None);

/// Threshold: if fewer than this many bits differ in the perceptual hash,
/// consider the screen unchanged. 64-bit hash -> 5 bits = ~8% change tolerance.
const HASH_UNCHANGED_THRESHOLD: u32 = 5;

/// Capture the screen without hiding the Dubly window.
///
/// The previous approach hid/showed the window on every capture, causing a
/// visible flash every 30 seconds. Dubly appearing in its own screenshot is
/// harmless — the LLM can see the avatar on screen and that's fine.
///
/// Returns a JSON object: `{ "b64": "...", "changed": true/false }`.
/// When `changed` is false, the caller can skip the LLM call entirely.
#[tauri::command]
pub async fn capture_screen(_app: AppHandle) -> Result<String, String> {
    capture_and_encode().await
}

async fn capture_and_encode() -> Result<String, String> {
    let monitors =
        xcap::Monitor::all().map_err(|e| format!("Failed to enumerate monitors: {e}"))?;

    let monitor = monitors
        .iter()
        .find(|m| m.is_primary().unwrap_or(false))
        .cloned()
        .or_else(|| monitors.into_iter().next())
        .ok_or("No monitor found")?;

    let screenshot = monitor
        .capture_image()
        .map_err(|e| format!("Failed to capture screen: {e}"))?;

    // Perf: compute perceptual hash to detect unchanged screens
    let current_hash = perceptual_hash(&screenshot);

    {
        let cache = SCREEN_CACHE.lock().unwrap();
        if let Some(ref cached) = *cache {
            if hash_distance(cached.last_hash, current_hash) < HASH_UNCHANGED_THRESHOLD {
                // Screen hasn't changed meaningfully — return cached image with changed=false
                let response = format!(
                    r#"{{"b64":"{}","changed":false}}"#,
                    cached.last_b64
                );
                return Ok(response);
            }
        }
    }

    // Perf: reduced resolution — 768x576 is sufficient for LLM vision models
    let resized = image::imageops::resize(
        &screenshot,
        768,
        576,
        image::imageops::FilterType::Triangle,
    );

    // Perf: lower JPEG quality to 60 — LLM doesn't need high-fidelity images
    let mut jpeg_bytes = Cursor::new(Vec::new());
    let encoder = JpegEncoder::new_with_quality(&mut jpeg_bytes, 60);
    image::DynamicImage::ImageRgba8(resized)
        .write_with_encoder(encoder)
        .map_err(|e| format!("Failed to encode JPEG: {e}"))?;

    // Base64 encode
    let b64 = base64::engine::general_purpose::STANDARD.encode(jpeg_bytes.into_inner());

    // Update cache
    {
        let mut cache = SCREEN_CACHE.lock().unwrap();
        *cache = Some(ScreenCache {
            last_hash: current_hash,
            last_b64: b64.clone(),
        });
    }

    let response = format!(r#"{{"b64":"{}","changed":true}}"#, b64);
    Ok(response)
}
