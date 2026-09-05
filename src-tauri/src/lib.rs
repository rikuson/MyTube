mod search;
use tauri::Manager;

pub fn run() {
    tauri::Builder::default()
        .manage(search::SearchState::default())
        .invoke_handler(tauri::generate_handler![
            search::start_search,
            search::search_status,
            search::cancel_search
        ])
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::CloseRequested { .. }) {
                window.state::<search::SearchState>().cancel_all();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running CodexTube");
}
