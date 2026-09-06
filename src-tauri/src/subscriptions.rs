use crate::search;
use crate::search::process;
use serde::Serialize;
use std::{
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant},
};
use tauri::State;

const FEED_URL: &str = "https://www.youtube.com/feed/subscriptions";
const SYNC_TIMEOUT: Duration = Duration::from_secs(120);
const MAX_VIDEOS: usize = 200;
const COOKIE_BROWSER: &str = "chrome";

#[derive(Clone, Copy, Serialize, Debug, PartialEq, Eq, Default)]
pub struct CookieBrowser;

impl CookieBrowser {
    #[cfg(test)]
    fn label(self) -> &'static str {
        "Chrome"
    }
    fn yt_arg(self) -> &'static str {
        COOKIE_BROWSER
    }
}

#[derive(Clone, Serialize)]
pub struct SubscriptionsResult {
    videos: Vec<search::Video>,
    elapsed_ms: u64,
}

#[derive(Clone, Serialize)]
pub struct Status {
    id: u64,
    phase: String,
    finished: bool,
    result: Option<SubscriptionsResult>,
    error: Option<String>,
}

struct ActiveJob {
    status: Status,
    cancel: Arc<AtomicBool>,
}

#[derive(Default)]
pub struct SubscriptionsState {
    job: Arc<Mutex<Option<ActiveJob>>>,
}

impl SubscriptionsState {
    pub fn selected_video(&self, id: &str) -> Result<search::Video, String> {
        let slot = self
            .job
            .lock()
            .map_err(|_| "登録チャンネルを取得できません。")?;
        slot.as_ref()
            .filter(|job| job.status.finished && !job.cancel.load(Ordering::SeqCst))
            .and_then(|job| job.status.result.as_ref())
            .and_then(|result| result.videos.iter().find(|video| video.id == id))
            .cloned()
            .ok_or("登録チャンネルから動画を選んでください。".into())
    }

    pub fn cancel_all(&self) {
        if let Ok(slot) = self.job.lock() {
            if let Some(job) = slot.as_ref() {
                job.cancel.store(true, Ordering::SeqCst);
            }
        }
        let deadline = Instant::now() + Duration::from_secs(2);
        while Instant::now() < deadline {
            let running = self
                .job
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
pub fn sync_subscriptions(state: State<'_, SubscriptionsState>) -> Result<u64, String> {
    let mut slot = state.job.lock().map_err(|_| "同期状態を取得できません。")?;
    if let Some(job) = slot.as_ref().filter(|job| !job.status.finished) {
        // React の開発時 Strict Mode などで同期開始が重複しても、同じジョブを
        // 監視できるようにする。エラーにすると呼び出し側が完了状態を取得できない。
        return Ok(job.status.id);
    }
    let id = slot.as_ref().map_or(1, |j| j.status.id + 1);
    let cancel = Arc::new(AtomicBool::new(false));
    *slot = Some(ActiveJob {
        status: Status {
            id,
            phase: "登録チャンネルを取得しています".into(),
            finished: false,
            result: None,
            error: None,
        },
        cancel: cancel.clone(),
    });
    let shared_job = state.inner().job.clone();
    std::thread::spawn(move || {
        let progress = |phase: &str| {
            if let Ok(mut slot) = shared_job.lock() {
                if let Some(job) = slot.as_mut().filter(|j| j.status.id == id) {
                    job.status.phase = phase.into();
                }
            }
        };
        let result = pipeline(CookieBrowser, &cancel, progress);
        if let Ok(mut slot) = shared_job.lock() {
            if let Some(job) = slot.as_mut().filter(|j| j.status.id == id) {
                job.status.finished = true;
                job.status.phase = "登録チャンネルの取得が完了しました".into();
                if cancel.load(Ordering::SeqCst) {
                    job.status.error = Some("同期をキャンセルしました。".into());
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
pub fn subscriptions_status(
    id: u64,
    state: State<'_, SubscriptionsState>,
) -> Result<Status, String> {
    state
        .job
        .lock()
        .map_err(|_| "同期状態を取得できません。")?
        .as_ref()
        .filter(|j| j.status.id == id)
        .map(|j| j.status.clone())
        .ok_or("同期が見つかりません。".into())
}

#[tauri::command]
pub fn cancel_subscriptions(id: u64, state: State<'_, SubscriptionsState>) -> Result<(), String> {
    let slot = state.job.lock().map_err(|_| "同期状態を取得できません。")?;
    if let Some(job) = slot.as_ref().filter(|j| j.status.id == id) {
        job.cancel.store(true, Ordering::SeqCst);
    }
    Ok(())
}

fn pipeline(
    browser: CookieBrowser,
    cancel: &Arc<AtomicBool>,
    progress: impl Fn(&str),
) -> Result<SubscriptionsResult, String> {
    let started = Instant::now();
    let deadline = started + SYNC_TIMEOUT;
    let dir = tempfile::Builder::new()
        .prefix("codextube-subscriptions-")
        .tempdir()
        .map_err(|_| "一時作業領域を作成できませんでした。")?;
    let yt = process::executable("yt-dlp")?;
    progress("YouTubeから登録チャンネルを取得しています");
    let args: Vec<String> = vec![
        "--ignore-config".into(),
        "--no-plugin-dirs".into(),
        "--no-cache-dir".into(),
        "--flat-playlist".into(),
        "--dump-single-json".into(),
        "--playlist-end".into(),
        MAX_VIDEOS.to_string(),
        "--socket-timeout".into(),
        "15".into(),
        "--retries".into(),
        "0".into(),
        "--cookies-from-browser".into(),
        browser.yt_arg().into(),
        "--".into(),
        FEED_URL.into(),
    ];
    let data = process::run(&yt, &args, dir.path(), vec![], cancel, deadline)?;
    let json: serde_json::Value =
        serde_json::from_slice(&data).map_err(|_| "登録チャンネルを読み取れませんでした。")?;
    let entries_owned = json
        .get("entries")
        .and_then(serde_json::Value::as_array)
        .cloned()
        .ok_or("登録チャンネルの形式が不正です。")?;
    let entries: Vec<serde_json::Value> = entries_owned.into_iter().take(MAX_VIDEOS).collect();
    progress("動画情報を整えています");
    let videos = search::parse_entries(&entries);
    Ok(SubscriptionsResult {
        videos,
        elapsed_ms: started.elapsed().as_millis() as u64,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cookie_browser_fixed_chrome() {
        let browser = CookieBrowser;
        assert_eq!(browser.yt_arg(), "chrome");
        assert_eq!(browser.label(), "Chrome");
    }

    #[test]
    fn cancel_all_marks_running_job() {
        let state = SubscriptionsState::default();
        let cancel = Arc::new(AtomicBool::new(false));
        *state.job.lock().unwrap() = Some(ActiveJob {
            status: Status {
                id: 1,
                phase: "進行中".into(),
                finished: false,
                result: None,
                error: None,
            },
            cancel: cancel.clone(),
        });
        state.cancel_all();
        assert!(cancel.load(Ordering::SeqCst));
    }

    #[test]
    fn parses_feed_entries_with_dedup_and_validation() {
        let entries = serde_json::json!([
            {"id": "aaaaaaaaaaa", "title": "新動画", "channel": "登録A", "description": "説明"},
            {"id": "aaaaaaaaaaa", "title": "重複", "channel": "登録A"},
            {"id": "bad id", "title": "不正ID"},
            {"id": "bbbbbbbbbbb", "title": "2本目", "channel": "登録B"},
        ]);
        let videos = search::parse_entries(entries.as_array().unwrap());
        assert_eq!(videos.len(), 2);
        assert_eq!(videos[0].id, "aaaaaaaaaaa");
        assert_eq!(videos[0].title, "新動画");
        assert_eq!(videos[1].id, "bbbbbbbbbbb");
        assert_eq!(videos[1].channel, "登録B");
    }
}
