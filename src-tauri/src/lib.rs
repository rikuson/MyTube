mod player_window;
mod search;
mod subscriptions;

use tauri::Manager;

#[tauri::command]
async fn open_video(
    id: String,
    app: tauri::AppHandle,
    state: tauri::State<'_, search::SearchState>,
    subscriptions: tauri::State<'_, subscriptions::SubscriptionsState>,
) -> Result<(), String> {
    if let Ok(video) = subscriptions.selected_video(&id) {
        return player_window::open(&app, &video.id, &video.title);
    }
    let video = state.selected_video(&id)?;
    player_window::open(&app, &video.id, &video.title)
}

pub fn run() {
    tauri::Builder::default()
        .manage(search::SearchState::default())
        .manage(subscriptions::SubscriptionsState::default())
        .invoke_handler(tauri::generate_handler![
            search::start_search,
            search::search_status,
            search::cancel_search,
            subscriptions::sync_subscriptions,
            subscriptions::subscriptions_status,
            subscriptions::cancel_subscriptions,
            open_video
        ])
        .on_window_event(|window, event| {
            if window.label() == "main"
                && matches!(event, tauri::WindowEvent::CloseRequested { .. })
            {
                window.state::<search::SearchState>().cancel_all();
                window
                    .state::<subscriptions::SubscriptionsState>()
                    .cancel_all();
                for (label, player) in window.app_handle().webview_windows() {
                    if label.starts_with("player-") {
                        let _ = player.close();
                    }
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running MyTube");
}
