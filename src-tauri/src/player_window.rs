use tauri::{
    webview::NewWindowResponse, AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder,
};

fn valid_id(id: &str) -> bool {
    id.len() == 11
        && id
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'_' || c == b'-')
}
fn allowed_navigation(url: &tauri::Url, origin: &str, id: &str) -> bool {
    url.as_str() == "about:blank"
        || url.as_str() == format!("{origin}/")
        || (url.scheme() == "https"
            && url.host_str() == Some("www.youtube.com")
            && url.path() == format!("/embed/{id}"))
}
pub fn open(app: &AppHandle, id: &str, title: &str) -> Result<(), String> {
    if !valid_id(id) {
        return Err("動画IDが不正です。".into());
    }
    let label = format!("player-{id}");
    if let Some(existing) = app.get_webview_window(&label) {
        existing.show().map_err(|_| "再生画面を表示できません。")?;
        return existing
            .set_focus()
            .map_err(|_| "再生画面を表示できません。".into());
    }
    for (label, window) in app.webview_windows() {
        if label.starts_with("player-") {
            window
                .close()
                .map_err(|_| "前の再生画面を閉じられません。")?;
        }
    }
    let origin = format!("https://{}", app.config().identifier.to_lowercase());
    let navigation_origin = origin.clone();
    let navigation_id = id.to_string();
    let window = WebviewWindowBuilder::new(
        app,
        label,
        WebviewUrl::External("about:blank".parse().unwrap()),
    )
    .title(format!("{title} — MyTube"))
    .inner_size(960., 660.)
    .min_inner_size(520., 440.)
    .on_navigation(move |url| allowed_navigation(url, &navigation_origin, &navigation_id))
    .on_new_window(|_, _| NewWindowResponse::Deny)
    .on_document_title_changed(|window, title| {
        let _ = window.emit("player-state", title);
    })
    .build()
    .map_err(|e| format!("再生画面を開けませんでした: {e}"))?;
    let html = include_str!("player.html")
        .replace("__VIDEO_ID__", &serde_json::to_string(id).unwrap())
        .replace("__ORIGIN__", &serde_json::to_string(&origin).unwrap());
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
        .map_err(|_| "再生画面を初期化できませんでした。".to_string())?;
    window
        .set_focus()
        .map_err(|_| "再生画面を表示できませんでした。".into())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn restrict_navigation_to_selected_embed() {
        let base = "https://com.codextube.desktop";
        let id = "abcdefghijk";
        for url in [
            "https://www.youtube.com/watch?v=abcdefghijk",
            "https://www.youtube.com/embed/other_video",
            "https://www.youtube.com.evil.test/embed/abcdefghijk",
            "https://example.com",
        ] {
            assert!(!allowed_navigation(&url.parse().unwrap(), base, id));
        }
        assert!(allowed_navigation(
            &"https://www.youtube.com/embed/abcdefghijk?rel=0"
                .parse()
                .unwrap(),
            base,
            id
        ));
        assert!(!valid_id("<script>"));
    }
}
