mod process;

use serde::Serialize;
use serde_json::Value;
use std::{
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant},
};
use tauri::State;

#[derive(Clone, Serialize)]
pub struct Video {
    pub id: String,
    pub title: String,
    pub channel: String,
    pub description: String,
}

#[derive(Clone, Serialize)]
pub struct SearchResult {
    videos: Vec<Video>,
    scanned: usize,
    elapsed_ms: u64,
}
#[derive(Clone, Serialize)]
pub struct Status {
    id: u64,
    phase: String,
    finished: bool,
    result: Option<SearchResult>,
    error: Option<String>,
}
struct Job {
    status: Status,
    cancel: Arc<AtomicBool>,
}
#[derive(Clone, Default)]
pub struct SearchState(Arc<Mutex<Option<Job>>>);
impl SearchState {
    pub fn selected_video(&self, id: &str) -> Result<Video, String> {
        let slot = self.0.lock().map_err(|_| "検索結果を取得できません。")?;
        slot.as_ref()
            .filter(|job| job.status.finished && !job.cancel.load(Ordering::SeqCst))
            .and_then(|job| job.status.result.as_ref())
            .and_then(|result| result.videos.iter().find(|video| video.id == id))
            .cloned()
            .ok_or("現在の検索結果から動画を選んでください。".into())
    }

    pub fn cancel_all(&self) {
        if let Ok(job) = self.0.lock() {
            if let Some(job) = job.as_ref() {
                job.cancel.store(true, Ordering::SeqCst);
            }
        }
        // Give the worker time to kill/reap its child before the event loop exits.
        let deadline = Instant::now() + Duration::from_secs(2);
        while Instant::now() < deadline {
            let running = self
                .0
                .lock()
                .is_ok_and(|slot| slot.as_ref().is_some_and(|j| !j.status.finished));
            if !running {
                break;
            }
            std::thread::sleep(Duration::from_millis(20));
        }
    }
}
#[tauri::command]
pub fn start_search(query: String, state: State<'_, SearchState>) -> Result<u64, String> {
    let query = query.trim().to_string();
    if query.is_empty() || query.chars().count() > 1000 {
        return Err("検索条件を1〜1000文字で入力してください。".into());
    }
    let mut slot = state.0.lock().map_err(|_| "検索状態を取得できません。")?;
    if slot.as_ref().is_some_and(|j| !j.status.finished) {
        return Err("実行中の検索が終了するまでお待ちください。".into());
    }
    let id = slot.as_ref().map_or(1, |j| j.status.id + 1);
    let cancel = Arc::new(AtomicBool::new(false));
    *slot = Some(Job {
        status: Status {
            id,
            phase: "YouTubeを検索しています".into(),
            finished: false,
            result: None,
            error: None,
        },
        cancel: cancel.clone(),
    });
    let shared = state.inner().clone();
    std::thread::spawn(move || {
        let progress = |phase: &str| {
            if let Ok(mut slot) = shared.0.lock() {
                if let Some(job) = slot.as_mut().filter(|j| j.status.id == id) {
                    job.status.phase = phase.into();
                }
            }
        };
        let result = pipeline(&query, &cancel, progress);
        if let Ok(mut slot) = shared.0.lock() {
            if let Some(job) = slot.as_mut().filter(|j| j.status.id == id) {
                job.status.finished = true;
                job.status.phase = "検索が完了しました".into();
                if cancel.load(Ordering::SeqCst) {
                    job.status.error = Some("検索をキャンセルしました。".into());
                } else {
                    match result {
                        Ok(result) => job.status.result = Some(result),
                        Err(error) => job.status.error = Some(error),
                    }
                }
            }
        }
    });
    Ok(id)
}
#[tauri::command]
pub fn search_status(id: u64, state: State<'_, SearchState>) -> Result<Status, String> {
    state
        .0
        .lock()
        .map_err(|_| "検索状態を取得できません。")?
        .as_ref()
        .filter(|j| j.status.id == id)
        .map(|j| j.status.clone())
        .ok_or("検索が見つかりません。".into())
}
#[tauri::command]
pub fn cancel_search(id: u64, state: State<'_, SearchState>) -> Result<(), String> {
    let slot = state.0.lock().map_err(|_| "検索状態を取得できません。")?;
    if let Some(job) = slot.as_ref().filter(|j| j.status.id == id) {
        job.cancel.store(true, Ordering::SeqCst);
    }
    Ok(())
}

fn strings(args: &[&str]) -> Vec<String> {
    args.iter().map(|s| s.to_string()).collect()
}
fn pipeline(
    query: &str,
    cancel: &Arc<AtomicBool>,
    progress: impl Fn(&str),
) -> Result<SearchResult, String> {
    let deadline = Instant::now() + Duration::from_secs(300);
    let dir = tempfile::Builder::new()
        .prefix("codextube-search-")
        .tempdir()
        .map_err(|_| "一時作業領域を作成できませんでした。")?;
    let yt = process::executable("yt-dlp")?;
    let started = Instant::now();
    progress("YouTubeを検索しています");
    let mut args = strings(&[
        "--ignore-config",
        "--no-plugin-dirs",
        "--no-cache-dir",
        "--flat-playlist",
        "--dump-single-json",
        "--socket-timeout",
        "15",
        "--retries",
        "0",
        "--",
    ]);
    args.push(format!("ytsearch5:{query}"));
    let data = process::run(&yt, &args, dir.path(), vec![], cancel, deadline)?;
    let playlist: Value =
        serde_json::from_slice(&data).map_err(|_| "候補動画を読み取れませんでした。")?;
    let entries = playlist
        .get("entries")
        .and_then(Value::as_array)
        .ok_or("候補動画の形式が不正です。")?;
    let videos = parse_videos(entries);
    Ok(SearchResult {
        videos,
        scanned: entries.len(),
        elapsed_ms: started.elapsed().as_millis() as u64,
    })
}

fn parse_videos(entries: &[Value]) -> Vec<Video> {
    let mut seen = std::collections::HashSet::new();
    entries
        .iter()
        .filter_map(|entry| {
            let id = entry.get("id")?.as_str()?;
            if id.len() != 11
                || !id
                    .bytes()
                    .all(|c| c.is_ascii_alphanumeric() || c == b'_' || c == b'-')
                || !seen.insert(id.to_string())
            {
                return None;
            }
            Some(Video {
                id: id.into(),
                title: entry
                    .get("title")
                    .and_then(Value::as_str)
                    .unwrap_or("タイトルなし")
                    .into(),
                channel: entry
                    .get("channel")
                    .and_then(Value::as_str)
                    .or_else(|| entry.get("uploader").and_then(Value::as_str))
                    .unwrap_or_default()
                    .into(),
                description: entry
                    .get("description")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .into(),
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn preserves_youtube_order_without_relevance_filtering() {
        let entries = serde_json::json!([
            {"id":"bbbbbbbbbbb", "title":"関係の薄い動画", "description":"そのまま表示"},
            {"id":"aaaaaaaaaaa", "title":"腕十字", "channel":"実演"},
            {"id":"../invalid", "title":"不正ID"}
        ]);
        let videos = parse_videos(entries.as_array().unwrap());
        assert_eq!(
            videos.iter().map(|v| v.id.as_str()).collect::<Vec<_>>(),
            vec!["bbbbbbbbbbb", "aaaaaaaaaaa"]
        );
        assert_eq!(videos[0].description, "そのまま表示");
        assert_eq!(videos[1].channel, "実演");
    }
    #[test]
    fn playback_only_accepts_current_successful_results() {
        let state = SearchState::default();
        assert!(state.selected_video("abcdefghijk").is_err());
        let video = Video {
            id: "abcdefghijk".into(),
            title: "動画".into(),
            channel: "チャンネル".into(),
            description: "説明".into(),
        };
        *state.0.lock().unwrap() = Some(Job {
            status: Status {
                id: 1,
                phase: "完了".into(),
                finished: true,
                result: Some(SearchResult {
                    videos: vec![video],
                    scanned: 1,
                    elapsed_ms: 1,
                }),
                error: None,
            },
            cancel: Arc::new(AtomicBool::new(false)),
        });
        assert!(state.selected_video("abcdefghijk").is_ok());
        assert!(state.selected_video("other_video").is_err());
        state
            .0
            .lock()
            .unwrap()
            .as_mut()
            .unwrap()
            .cancel
            .store(true, Ordering::SeqCst);
        assert!(state.selected_video("abcdefghijk").is_err());
    }

    #[test]
    #[ignore = "Uses live YouTube"]
    fn live_search_smoke() {
        let result = pipeline(
            "腕十字のやり方",
            &Arc::new(AtomicBool::new(false)),
            |phase| eprintln!("{phase}"),
        )
        .unwrap();
        eprintln!(
            "scanned={}, elapsed_ms={}, displayed={}",
            result.scanned,
            result.elapsed_ms,
            result.videos.len()
        );
        assert!(
            !result.videos.is_empty(),
            "Expected relevant armbar tutorials"
        );
        assert!(result.scanned > 0);
    }
}
