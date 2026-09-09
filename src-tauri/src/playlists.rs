use crate::search::{self, process};
use serde::Serialize;
use serde_json::Value;
use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant},
};

#[derive(Clone, Serialize)]
pub struct Playlist {
    id: String,
    title: String,
}
#[derive(Clone, Serialize)]
pub struct PlaylistPage {
    videos: Vec<search::Video>,
    page: u32,
    has_next: bool,
}
#[derive(Default)]
pub struct PlaylistState {
    catalog: Mutex<Option<Vec<Playlist>>>,
    videos: Mutex<HashMap<String, search::Video>>,
    requests: Mutex<Vec<Arc<AtomicBool>>>,
}
impl PlaylistState {
    pub fn selected_video(&self, id: &str) -> Result<search::Video, String> {
        self.videos
            .lock()
            .map_err(|_| "動画を取得できません。")?
            .get(id)
            .cloned()
            .ok_or("再生リストから動画を選択してください。".into())
    }
    pub fn cancel_all(&self) {
        if let Ok(requests) = self.requests.lock() {
            for request in requests.iter() {
                request.store(true, Ordering::SeqCst);
            }
        }
    }
    fn request(&self) -> Result<Arc<AtomicBool>, String> {
        let cancel = Arc::new(AtomicBool::new(false));
        let mut requests = self
            .requests
            .lock()
            .map_err(|_| "再生リストを取得できません。")?;
        requests.retain(|request| Arc::strong_count(request) > 1);
        requests.push(cancel.clone());
        Ok(cancel)
    }
}
fn valid_id(id: &str) -> bool {
    (2..=100).contains(&id.len())
        && id
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'_' || c == b'-')
        && !id.starts_with("RD")
}
fn catalog(json: &Value) -> Result<Vec<Playlist>, String> {
    let entries = json
        .get("entries")
        .and_then(Value::as_array)
        .ok_or("再生リストの形式が不正です。")?;
    let mut seen = std::collections::HashSet::new();
    Ok(entries
        .iter()
        .filter_map(|entry| {
            let id = entry.get("id")?.as_str()?;
            let title = entry.get("title")?.as_str()?.trim();
            (valid_id(id) && !title.is_empty() && seen.insert(id)).then(|| Playlist {
                id: id.into(),
                title: title.into(),
            })
        })
        .collect())
}
fn fetch(url: String, page: Option<u32>, cancel: Arc<AtomicBool>) -> Result<Value, String> {
    let dir = tempfile::Builder::new()
        .prefix("mytube-playlists-")
        .tempdir()
        .map_err(|_| "一時領域を作成できません。")?;
    let yt = process::executable("yt-dlp")?;
    let mut args: Vec<String> = [
        "--ignore-config",
        "--no-plugin-dirs",
        "--no-cache-dir",
        "--flat-playlist",
        "--dump-single-json",
        "--socket-timeout",
        "15",
        "--retries",
        "0",
        "--cookies-from-browser",
        "chrome",
    ]
    .into_iter()
    .map(String::from)
    .collect();
    if let Some(page) = page {
        args.extend([
            "--playlist-start".into(),
            ((page - 1) * 25 + 1).to_string(),
            "--playlist-end".into(),
            (page * 25 + 1).to_string(),
        ]);
    }
    args.extend(["--".into(), url]);
    let data = process::run(
        &yt,
        &args,
        dir.path(),
        vec![],
        &cancel,
        Instant::now() + Duration::from_secs(120),
    )?;
    serde_json::from_slice(&data).map_err(|_| "再生リストを読み取れませんでした。".into())
}
#[tauri::command]
pub async fn fetch_playlists(
    force: bool,
    state: tauri::State<'_, PlaylistState>,
) -> Result<Vec<Playlist>, String> {
    if !force {
        if let Some(cached) = state
            .catalog
            .lock()
            .map_err(|_| "再生リストを取得できません。")?
            .clone()
        {
            return Ok(cached);
        }
    }
    let cancel = state.request()?;
    let items = tauri::async_runtime::spawn_blocking(move || {
        catalog(&fetch(
            "https://www.youtube.com/feed/playlists".into(),
            None,
            cancel,
        )?)
    })
    .await
    .map_err(|_| "再生リストの取得に失敗しました。")??;
    *state
        .catalog
        .lock()
        .map_err(|_| "再生リストを保存できません。")? = Some(items.clone());
    Ok(items)
}
#[tauri::command]
pub async fn fetch_playlist_videos(
    playlist_id: String,
    page: u32,
    state: tauri::State<'_, PlaylistState>,
) -> Result<PlaylistPage, String> {
    if !(1..=1000).contains(&page) {
        return Err("ページ番号が範囲外です。".into());
    }
    if !state
        .catalog
        .lock()
        .map_err(|_| "再生リストを取得できません。")?
        .as_ref()
        .is_some_and(|items| items.iter().any(|item| item.id == playlist_id))
    {
        return Err("取得した再生リストから選択してください。".into());
    }
    let cancel = state.request()?;
    let result = tauri::async_runtime::spawn_blocking(move || {
        let json = fetch(
            format!("https://www.youtube.com/playlist?list={playlist_id}"),
            Some(page),
            cancel,
        )?;
        let entries = json
            .get("entries")
            .and_then(Value::as_array)
            .ok_or("動画一覧の形式が不正です。")?;
        Ok::<_, String>(PlaylistPage {
            videos: search::parse_entries(&entries[..entries.len().min(25)], None),
            page,
            has_next: entries.len() > 25,
        })
    })
    .await
    .map_err(|_| "動画一覧の取得に失敗しました。")??;
    state
        .videos
        .lock()
        .map_err(|_| "動画を保存できません。")?
        .extend(
            result
                .videos
                .iter()
                .cloned()
                .map(|video| (video.id.clone(), video)),
        );
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn catalog_rejects_invalid_ids_and_deduplicates() {
        let items = catalog(&serde_json::json!({"entries":[{"id":"PLabc", "title":"日本語"},{"id":"PLabc", "title":"English"},{"id":"../../bad", "title":"bad"},{"id":"RDmix", "title":"Mix"}]})).unwrap();
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].title, "日本語");
        assert!(catalog(&serde_json::json!({})).is_err());
    }
}
