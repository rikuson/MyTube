mod player_server;
mod playlists;
mod search;
mod subscriptions;

use tauri::Manager;
use tauri_plugin_opener::OpenerExt;

fn selected_video(
    id: &str,
    state: &search::SearchState,
    subscriptions: &subscriptions::SubscriptionsState,
    playlists: &playlists::PlaylistState,
) -> Result<search::Video, String> {
    subscriptions
        .selected_video(id)
        .or_else(|_| state.selected_video(id))
        .or_else(|_| playlists.selected_video(id))
}

#[tauri::command]
fn player_url(
    id: String,
    state: tauri::State<'_, search::SearchState>,
    subscriptions: tauri::State<'_, subscriptions::SubscriptionsState>,
    server: tauri::State<'_, player_server::PlayerServer>,
    playlists: tauri::State<'_, playlists::PlaylistState>,
) -> Result<String, String> {
    selected_video(&id, &state, &subscriptions, &playlists)?;
    server.url(&id)
}

#[tauri::command]
fn open_video_in_browser(
    id: String,
    app: tauri::AppHandle,
    state: tauri::State<'_, search::SearchState>,
    subscriptions: tauri::State<'_, subscriptions::SubscriptionsState>,
    playlists: tauri::State<'_, playlists::PlaylistState>,
) -> Result<(), String> {
    selected_video(&id, &state, &subscriptions, &playlists)?;
    app.opener()
        .open_url(
            format!("https://www.youtube.com/watch?v={id}"),
            None::<&str>,
        )
        .map_err(|_| "ブラウザでYouTubeを開けませんでした。".to_string())
}

#[tauri::command]
fn open_channel_in_browser(channel_id: String, app: tauri::AppHandle) -> Result<(), String> {
    subscriptions::validate_channel_id(&channel_id)?;
    app.opener()
        .open_url(
            format!("https://www.youtube.com/channel/{channel_id}"),
            None::<&str>,
        )
        .map_err(|_| "ブラウザでYouTubeを開けませんでした。".to_string())
}

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
    playlists: tauri::State<'_, playlists::PlaylistState>,
) -> Result<search::Video, String> {
    let video = selected_video(&id, &state, &subscriptions, &playlists)?;
    Ok(subscriptions::hydrate_video(video).await)
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(search::SearchState::default())
        .manage(subscriptions::SubscriptionsState::default())
        .manage(playlists::PlaylistState::default())
        .invoke_handler(tauri::generate_handler![
            search::start_search,
            search::search_status,
            search::cancel_search,
            subscriptions::sync_subscriptions,
            subscriptions::cached_subscriptions,
            subscriptions::subscriptions_status,
            subscriptions::cancel_subscriptions,
            subscriptions::fetch_channel_videos,
            playlists::fetch_playlists,
            playlists::fetch_playlist_videos,
            restore_window_title,
            player_url,
            open_video_in_browser,
            open_channel_in_browser,
            hydrate_video
        ])
        .setup(|app| {
            use objc2::{AllocAnyThread, MainThreadMarker};
            use objc2_app_kit::{NSApplication, NSImage};
            use objc2_foundation::NSData;

            let mtm = MainThreadMarker::new().ok_or("メインスレッドではありません。")?;
            let data = NSData::with_bytes(include_bytes!("../icons/icon.icns"));
            let icon = NSImage::initWithData(NSImage::alloc(), &data)
                .ok_or("アプリアイコンを読み込めません。")?;
            unsafe { NSApplication::sharedApplication(mtm).setApplicationIconImage(Some(&icon)) };
            app.manage(player_server::PlayerServer::start()?);
            if let Some(window) = app.get_webview_window("main") {
                window.with_webview(|webview| unsafe {
                    let view: &objc2_web_kit::WKWebView = &*webview.inner().cast();
                    view.setAllowsBackForwardNavigationGestures(true);
                    view.configuration()
                        .preferences()
                        .setElementFullscreenEnabled(true);
                })?;
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == "main"
                && matches!(event, tauri::WindowEvent::CloseRequested { .. })
            {
                window.state::<search::SearchState>().cancel_all();
                window.state::<playlists::PlaylistState>().cancel_all();
                window
                    .state::<subscriptions::SubscriptionsState>()
                    .cancel_all();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running MyTube");
}
