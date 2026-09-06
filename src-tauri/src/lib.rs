mod player_window;
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
async fn open_video(
    id: String,
    app: tauri::AppHandle,
    state: tauri::State<'_, search::SearchState>,
    subscriptions: tauri::State<'_, subscriptions::SubscriptionsState>,
) -> Result<(), String> {
    let video = subscriptions
        .selected_video(&id)
        .or_else(|_| state.selected_video(&id))?;
    let is_registered = subscriptions.is_registered_channel(video.channel_id.as_deref());
    player_window::open(
        &app,
        &video.id,
        &video.title,
        &video.channel,
        video.channel_id.clone(),
        is_registered,
        video.channel_icon.clone(),
        Some(video.description.clone()),
        video.published_at,
    )?;

    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        let video = subscriptions::hydrate_video(video).await;
        let _ = player_window::update_details(
            &app_handle,
            &video.id,
            &video.channel,
            video.channel_id,
            video.channel_icon,
            Some(video.description),
            video.published_at,
        );
    });
    Ok(())
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
            subscriptions::fetch_channel_videos,
            restore_window_title,
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
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running MyTube");
}
