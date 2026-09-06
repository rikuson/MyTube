mod player_window;
mod search;
use tauri::Manager;

#[tauri::command]
async fn open_video(
    id: String,
    app: tauri::AppHandle,
    state: tauri::State<'_, search::SearchState>,
) -> Result<(), String> {
    let video = state.selected_video(&id)?;
    player_window::open(&app, &video.id, &video.title)
}

pub fn run() {
    tauri::Builder::default()
        .manage(search::SearchState::default())
        .invoke_handler(tauri::generate_handler![
            search::start_search,
            search::search_status,
            search::cancel_search,
            open_video
        ])
        .on_window_event(|window, event| {
            if window.label() == "main"
                && matches!(event, tauri::WindowEvent::CloseRequested { .. })
            {
                window.state::<search::SearchState>().cancel_all();
                for (label, player) in window.app_handle().webview_windows() {
                    if label.starts_with("player-") {
                        let _ = player.close();
                    }
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running CodexTube");
}
