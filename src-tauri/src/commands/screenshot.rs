use base64::Engine;
use image::codecs::jpeg::JpegEncoder;
use std::io::Cursor;
use tauri::{AppHandle, Manager};

#[tauri::command]
pub async fn capture_screen(app: AppHandle) -> Result<String, String> {
    let window = app
        .get_webview_window("main")
        .ok_or("Failed to get main window")?;

    // Only hide the window if it is currently visible. Some platforms return an
    // error when hiding an already-hidden window, and we must not abort in that
    // case.  Track whether we performed the hide so we only re-show when needed.
    let was_visible = window.is_visible().unwrap_or(true);

    if was_visible {
        // Best-effort hide -- if it fails we still attempt the capture because
        // the worst outcome is seeing our own window in the screenshot, which
        // is far better than returning no screenshot at all.
        if window.hide().is_ok() {
            // Small delay to let the compositor finish removing the window.
            tokio::time::sleep(std::time::Duration::from_millis(150)).await;
        }
    }

    // Capture the screen
    let result = capture_and_encode().await;

    // Re-show the window only if we hid it
    if was_visible {
        let _ = window.show();
    }

    result
}

async fn capture_and_encode() -> Result<String, String> {
    let monitors =
        xcap::Monitor::all().map_err(|e| format!("Failed to enumerate monitors: {e}"))?;

    let monitor = monitors
        .into_iter()
        .find(|m| m.is_primary().unwrap_or(false))
        .or_else(|| xcap::Monitor::all().ok().and_then(|m| m.into_iter().next()))
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
