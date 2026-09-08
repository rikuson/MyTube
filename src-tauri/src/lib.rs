mod search;
mod subscriptions;

use tauri::Manager;

#[tauri::command]
fn restore_window_title(app: tauri::AppHandle) -> Result<(), String> {
    app.get_webview_window("main")
        .ok_or("メイン画面を取得できません。")?
        .set_title("MyTube")
        .map_err(|_| "ウィンドウタイトルを戻せませんでした。".to_string())
}

#[tauri::command]
async fn hydrate_video(
    id: String,
    state: tauri::State<'_, search::SearchState>,
    subscriptions: tauri::State<'_, subscriptions::SubscriptionsState>,
) -> Result<search::Video, String> {
    let video = subscriptions
        .selected_video(&id)
        .or_else(|_| state.selected_video(&id))?;
    Ok(subscriptions::hydrate_video(video).await)
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
            subscriptions::cached_subscriptions,
            subscriptions::subscriptions_status,
            subscriptions::cancel_subscriptions,
            subscriptions::fetch_channel_videos,
            restore_window_title,
            hydrate_video
        ])
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                window.with_webview(|webview| unsafe {
                    let view: &objc2_web_kit::WKWebView = &*webview.inner().cast();
                    view.configuration().preferences().setElementFullscreenEnabled(true);
                })?;
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == "main"
                && matches!(event, tauri::WindowEvent::CloseRequested { .. })
            {
                window.state::<search::SearchState>().cancel_all();
                window
                    .state::<subscriptions::SubscriptionsState>()
                    .cancel_all();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running MyTube");
}
