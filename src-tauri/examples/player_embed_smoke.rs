//! Native check of the same nested HTTP player used inside the React layout.
#[path = "../src/player_server.rs"]
mod player_server;
use tauri::Manager;

#[tauri::command]
fn smoke_report(state: String) {
    println!("PLAYER {state}");
}

fn main() {
    let server = player_server::PlayerServer::start().unwrap();
    let url = server.url("M7lc1UVf-VE").unwrap();
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![smoke_report])
        .on_page_load(move |webview, payload| {
            if payload.event() != tauri::webview::PageLoadEvent::Finished { return; }
            let script = format!(r#"
                document.body.innerHTML = '<h2>Native nested player check</h2>';
                const frame = document.createElement('iframe');
                frame.src = {url};
                frame.allow = 'autoplay; fullscreen';
                frame.allowFullscreen = true;
                frame.style = 'width:960px;height:540px;border:0';
                document.body.appendChild(frame);
                window.addEventListener('message', event => {{
                    if (event.source === frame.contentWindow && event.data?.type === 'mytube-player') {{
                        window.__TAURI_INTERNALS__.invoke('smoke_report', {{ state: event.data.state }});
                    }}
                }});
            "#, url = serde_json::to_string(&url).unwrap());
            webview.eval(&script).unwrap();
        })
        .setup(|app| {
            app.get_webview_window("main").unwrap().with_webview(|webview| unsafe {
                let view: &objc2_web_kit::WKWebView = &*webview.inner().cast();
                view.configuration().preferences().setElementFullscreenEnabled(true);
            })?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .unwrap();
}
