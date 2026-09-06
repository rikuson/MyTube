use tauri::{AppHandle, Manager};

fn valid_id(id: &str) -> bool {
    id.len() == 11
        && id
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'_' || c == b'-')
}
pub fn open(
    app: &AppHandle,
    id: &str,
    title: &str,
    channel: &str,
    channel_id: Option<String>,
    is_registered: bool,
    channel_icon: Option<String>,
    description: Option<String>,
) -> Result<(), String> {
    if !valid_id(id) {
        return Err("動画IDが不正です。".into());
    }
    let window = app
        .get_webview_window("main")
        .ok_or("メイン画面を取得できません。")?;
    let return_url = window.url().map_err(|_| "元の画面を取得できません。")?;
    let origin = format!("https://{}", app.config().identifier.to_lowercase());
    let html = include_str!("player.html")
        .replace("__VIDEO_ID__", &serde_json::to_string(id).unwrap())
        .replace("__ORIGIN__", &serde_json::to_string(&origin).unwrap())
        .replace("__TITLE__", &serde_json::to_string(title).unwrap())
        .replace("__CHANNEL__", &serde_json::to_string(channel).unwrap())
        .replace(
            "__CHANNEL_ID__",
            &serde_json::to_string(&channel_id.unwrap_or_default()).unwrap(),
        )
        .replace(
            "__IS_REGISTERED__",
            if is_registered { "true" } else { "false" },
        )
        .replace(
            "__CHANNEL_ICON__",
            &serde_json::to_string(&channel_icon.unwrap_or_default()).unwrap(),
        )
        .replace(
            "__DESCRIPTION__",
            &serde_json::to_string(&description.unwrap_or_default()).unwrap(),
        )
        .replace(
            "__RETURN_URL__",
            &serde_json::to_string(return_url.as_str()).unwrap(),
        );
    window
        .set_title(&format!("{title} — MyTube"))
        .map_err(|_| "再生画面を表示できません。")?;
    window
        .with_webview(move |webview| {
            // Tauri dispatches this closure onto the WKWebView main thread.
            // A HTTPS base URL identifies our app to YouTube (avoids error 153).
            unsafe {
                let view: &objc2_web_kit::WKWebView = &*webview.inner().cast();
                let base = objc2_foundation::NSURL::URLWithString(
                    &objc2_foundation::NSString::from_str(&format!("{origin}/")),
                )
                .unwrap();
                view.loadHTMLString_baseURL(
                    &objc2_foundation::NSString::from_str(&html),
                    Some(&base),
                );
            }
        })
        .map_err(|_| "再生画面を初期化できませんでした。".to_string())
}

pub fn update_details(
    app: &AppHandle,
    id: &str,
    channel: &str,
    channel_id: Option<String>,
    channel_icon: Option<String>,
    description: Option<String>,
) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or("メイン画面を取得できません。")?;
    let script = format!(
        "window.__setVideoDetails?.({}, {}, {}, {}, {});",
        serde_json::to_string(id).unwrap(),
        serde_json::to_string(channel).unwrap(),
        serde_json::to_string(&channel_id.unwrap_or_default()).unwrap(),
        serde_json::to_string(&channel_icon.unwrap_or_default()).unwrap(),
        serde_json::to_string(&description.unwrap_or_default()).unwrap(),
    );
    window
        .eval(&script)
        .map_err(|_| "動画情報を更新できませんでした。".to_string())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_youtube_video_ids_are_accepted() {
        assert!(valid_id("abcdefghijk"));
        assert!(!valid_id("<script>"));
    }
}
