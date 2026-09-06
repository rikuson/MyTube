//! Manual native WKWebView smoke test; loads a public YouTube API demo video.
//! cargo run --manifest-path src-tauri/Cargo.toml --example player_smoke
#[path = "../src/player_window.rs"]
mod player_window;
use std::sync::{
    atomic::{AtomicUsize, Ordering},
    Arc,
};
use tauri::{Listener, Manager};
fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let handle = app.handle().clone();
            let step = Arc::new(AtomicUsize::new(0));
            app.listen("player-state", move |event| {
                let state: String = serde_json::from_str(event.payload()).unwrap_or_default();
                eprintln!("{state}");
                let Some(window) = handle.get_webview_window("player-M7lc1UVf-VE") else {
                    return;
                };
                match state.as_str() {
                    "CodexTube: ready" => {
                        let _ = window.eval("player.playVideo()");
                    }
                    "CodexTube: playing" => {
                        let step = step.fetch_add(1, Ordering::SeqCst);
                        std::thread::spawn(move || {
                            std::thread::sleep(std::time::Duration::from_secs(2));
                            let _ = window.eval(if step == 0 {
                                "player.pauseVideo()"
                            } else {
                                "player.seekTo(player.getDuration() - 1, true)"
                            });
                        });
                    }
                    "CodexTube: paused" => {
                        let _ = window.eval("player.playVideo()");
                    }
                    "CodexTube: ended" => handle.exit(0),
                    value if value.starts_with("CodexTube: error") => handle.exit(1),
                    _ => {}
                }
            });
            player_window::open(app.handle(), "M7lc1UVf-VE", "再生確認")?;
            let timeout = app.handle().clone();
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_secs(45));
                timeout.exit(2);
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("native playback smoke test failed");
}
