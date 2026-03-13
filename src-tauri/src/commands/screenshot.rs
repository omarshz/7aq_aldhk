use base64::Engine;
use image::codecs::jpeg::JpegEncoder;
use std::io::Cursor;
use tauri::AppHandle;

/// Capture the screen without hiding the Dubly window.
///
/// The previous approach hid/showed the window on every capture, causing a
/// visible flash every 30 seconds. Dubly appearing in its own screenshot is
/// harmless — the LLM can see the avatar on screen and that's fine.
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

    // Resize to 1024x768 to keep payload small
    let resized = image::imageops::resize(
        &screenshot,
        1024,
        768,
        image::imageops::FilterType::Triangle,
    );

    // Encode as JPEG
    let mut jpeg_bytes = Cursor::new(Vec::new());
    let encoder = JpegEncoder::new_with_quality(&mut jpeg_bytes, 75);
    image::DynamicImage::ImageRgba8(resized)
        .write_with_encoder(encoder)
        .map_err(|e| format!("Failed to encode JPEG: {e}"))?;

    // Base64 encode
    let b64 = base64::engine::general_purpose::STANDARD.encode(jpeg_bytes.into_inner());

    Ok(b64)
}
