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
    let video = subscriptions
        .selected_video(&id)
        .or_else(|_| state.selected_video(&id))?;
    player_window::open(
        &app,
        &video.id,
        &video.title,
        &video.channel,
        video.channel_id.clone(),
        video.channel_icon.clone(),
        Some(video.description.clone()),
    )?;

    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        let video = subscriptions::hydrate_video(video).await;
        let _ = player_window::update_details(
            &app_handle,
            &video.id,
            &video.channel,
            video.channel_icon,
            Some(video.description),
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
