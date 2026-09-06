//! Manual current-window player check.
//! cargo run --manifest-path src-tauri/Cargo.toml --example player_smoke
#[path = "../src/player_window.rs"]
mod player_window;

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            player_window::open(
                app.handle(),
                "M7lc1UVf-VE",
                "再生確認",
                "YouTube Developers",
            )?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("native playback smoke test failed");
}
