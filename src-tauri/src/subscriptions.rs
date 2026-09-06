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
const CHANNELS_URL: &str = "https://www.youtube.com/feed/channels";
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
    channel_icons: std::collections::HashMap<String, String>,
    channel_ids: std::collections::HashMap<String, String>,
    elapsed_ms: u64,
}

#[derive(Clone, Serialize)]
pub struct ChannelVideosResult {
    videos: Vec<search::Video>,
    page: u32,
    has_next: bool,
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
    fetched_videos: Arc<Mutex<std::collections::HashMap<String, search::Video>>>,
}

impl SubscriptionsState {
    pub fn is_registered_channel(&self, channel_id: Option<&str>) -> bool {
        let Some(channel_id) = channel_id else {
            return false;
        };
        self.job
            .lock()
            .ok()
            .and_then(|slot| slot.as_ref()?.status.result.clone())
            .is_some_and(|result| result.channel_ids.values().any(|id| id == channel_id))
    }

    pub fn selected_video(&self, id: &str) -> Result<search::Video, String> {
        let slot = self
            .job
            .lock()
            .map_err(|_| "登録チャンネルを取得できません。")?;
        if let Some(video) = slot
            .as_ref()
            .filter(|job| job.status.finished && !job.cancel.load(Ordering::SeqCst))
            .and_then(|job| job.status.result.as_ref())
            .and_then(|result| result.videos.iter().find(|video| video.id == id))
            .cloned()
        {
            return Ok(video);
        }
        drop(slot);
        self.fetched_videos
            .lock()
            .map_err(|_| "チャンネル動画を取得できません。")?
            .get(id)
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
    if let Some(job) = slot
        .as_ref()
        .filter(|job| !job.status.finished && !job.cancel.load(Ordering::SeqCst))
    {
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

pub async fn hydrate_video(video: search::Video) -> search::Video {
    let fallback = video.clone();
    match tauri::async_runtime::spawn_blocking(move || hydrate_video_blocking(video)).await {
        Ok(Ok(video)) => video,
        _ => fallback,
    }
}

fn hydrate_video_blocking(mut video: search::Video) -> Result<search::Video, String> {
    let deadline = Instant::now() + Duration::from_secs(45);
    let dir = tempfile::Builder::new()
        .prefix("codextube-details-")
        .tempdir()
        .map_err(|_| "一時作業領域を作成できませんでした。")?;
    let yt = process::executable("yt-dlp")?;
    let cancel = Arc::new(AtomicBool::new(false));
    let args = vec![
        "--ignore-config".into(),
        "--no-plugin-dirs".into(),
        "--no-cache-dir".into(),
        "--skip-download".into(),
        "--dump-single-json".into(),
        "--no-playlist".into(),
        "--socket-timeout".into(),
        "15".into(),
        "--retries".into(),
        "0".into(),
        "--cookies-from-browser".into(),
        COOKIE_BROWSER.into(),
        "--".into(),
        format!("https://www.youtube.com/watch?v={}", video.id),
    ];
    let data = process::run(&yt, &args, dir.path(), vec![], &cancel, deadline)?;
    let details: serde_json::Value =
        serde_json::from_slice(&data).map_err(|_| "動画情報を読み取れませんでした。")?;
    if let Some(description) = details
        .get("description")
        .and_then(serde_json::Value::as_str)
    {
        video.description = description.chars().take(20_000).collect();
    }
    video.published_at = details
        .get("timestamp")
        .or_else(|| details.get("release_timestamp"))
        .and_then(serde_json::Value::as_i64)
        .or(video.published_at);
    if let Some(channel) = details.get("channel").and_then(serde_json::Value::as_str) {
        video.channel = channel.to_string();
    }
    if let Some(channel_id) = details
        .get("channel_id")
        .and_then(serde_json::Value::as_str)
        .filter(|id| validate_channel_id(id).is_ok())
    {
        video.channel_id = Some(channel_id.to_string());
    }
    if let Some(channel_id) = video.channel_id.as_deref() {
        video.channel_icon = fetch_channel_avatar(&yt, channel_id, dir.path(), &cancel, deadline);
    }
    Ok(video)
}

fn fetch_channel_avatar(
    yt: &std::path::Path,
    channel_id: &str,
    cwd: &std::path::Path,
    cancel: &Arc<AtomicBool>,
    deadline: Instant,
) -> Option<String> {
    let args = vec![
        "--ignore-config".into(),
        "--no-plugin-dirs".into(),
        "--no-cache-dir".into(),
        "--flat-playlist".into(),
        "--dump-single-json".into(),
        "--playlist-end".into(),
        "1".into(),
        "--socket-timeout".into(),
        "15".into(),
        "--retries".into(),
        "0".into(),
        "--cookies-from-browser".into(),
        COOKIE_BROWSER.into(),
        "--".into(),
        format!("https://www.youtube.com/channel/{channel_id}"),
    ];
    let data = process::run(yt, &args, cwd, vec![], cancel, deadline).ok()?;
    let channel: serde_json::Value = serde_json::from_slice(&data).ok()?;
    extract_channel_avatar(&channel)
}

fn extract_channel_avatar(value: &serde_json::Value) -> Option<String> {
    let thumbnails = value.get("thumbnails")?.as_array()?;
    thumbnails
        .iter()
        .rev()
        .find(|thumbnail| {
            thumbnail
                .get("id")
                .and_then(serde_json::Value::as_str)
                .is_some_and(|id| id.contains("avatar"))
        })
        .or_else(|| {
            thumbnails.iter().rev().find(|thumbnail| {
                let width = thumbnail.get("width").and_then(serde_json::Value::as_u64);
                let height = thumbnail.get("height").and_then(serde_json::Value::as_u64);
                width.is_some() && width == height
            })
        })
        .and_then(|thumbnail| thumbnail.get("url"))
        .and_then(serde_json::Value::as_str)
        .and_then(|url| {
            let url = if url.starts_with("//") {
                format!("https:{url}")
            } else {
                url.to_string()
            };
            (url.starts_with("https://yt3.googleusercontent.com/")
                || url.starts_with("https://yt3.ggpht.com/"))
            .then_some(url)
        })
}

#[tauri::command]
pub async fn fetch_channel_videos(
    channel_id: String,
    page: u32,
    state: State<'_, SubscriptionsState>,
) -> Result<ChannelVideosResult, String> {
    validate_channel_id(&channel_id)?;
    let (start, end) = page_bounds(page)?;
    let fetched_videos = state.fetched_videos.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        channel_pipeline(CookieBrowser, &channel_id, page, start, end)
    })
    .await
    .map_err(|_| "チャンネル動画の取得に失敗しました。")??;
    let mut stored = fetched_videos
        .lock()
        .map_err(|_| "チャンネル動画を保存できません。")?;
    stored.extend(
        result
            .videos
            .iter()
            .cloned()
            .map(|video| (video.id.clone(), video)),
    );
    Ok(result)
}

fn validate_channel_id(channel_id: &str) -> Result<(), String> {
    if channel_id.len() == 24
        && channel_id.starts_with("UC")
        && channel_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
    {
        Ok(())
    } else {
        Err("チャンネルIDが不正です。".into())
    }
}

fn page_bounds(page: u32) -> Result<(u32, u32), String> {
    if page == 0 || page > 1000 {
        return Err("ページ番号が範囲外です。".into());
    }
    Ok(((page - 1) * 50 + 1, page * 50 + 1))
}

fn channel_pipeline(
    browser: CookieBrowser,
    channel_id: &str,
    page: u32,
    start: u32,
    end: u32,
) -> Result<ChannelVideosResult, String> {
    let started = Instant::now();
    let deadline = started + SYNC_TIMEOUT;
    let dir = tempfile::Builder::new()
        .prefix("codextube-channel-")
        .tempdir()
        .map_err(|_| "一時作業領域を作成できませんでした。")?;
    let yt = process::executable("yt-dlp")?;
    let args = vec![
        "--ignore-config".into(),
        "--no-plugin-dirs".into(),
        "--no-cache-dir".into(),
        "--flat-playlist".into(),
        "--extractor-args".into(),
        "youtubetab:approximate_date".into(),
        "--dump-single-json".into(),
        "--playlist-start".into(),
        start.to_string(),
        "--playlist-end".into(),
        end.to_string(),
        "--socket-timeout".into(),
        "15".into(),
        "--retries".into(),
        "0".into(),
        "--cookies-from-browser".into(),
        browser.yt_arg().into(),
        "--".into(),
        format!("https://www.youtube.com/channel/{channel_id}/videos"),
    ];
    let cancel = Arc::new(AtomicBool::new(false));
    let data = process::run(&yt, &args, dir.path(), vec![], &cancel, deadline)?;
    let json: serde_json::Value =
        serde_json::from_slice(&data).map_err(|_| "チャンネル動画を読み取れませんでした。")?;
    let entries = json
        .get("entries")
        .and_then(serde_json::Value::as_array)
        .ok_or("チャンネル動画の形式が不正です。")?;
    let has_next = entries.len() > 50;
    let channel = json
        .get("channel")
        .and_then(serde_json::Value::as_str)
        .unwrap_or_default();
    let avatar = extract_channel_avatar(&json);
    let mut page_entries = entries[..entries.len().min(50)].to_vec();
    for entry in &mut page_entries {
        if let Some(object) = entry.as_object_mut() {
            if object.get("channel").is_none_or(serde_json::Value::is_null) {
                object.insert("channel".into(), channel.into());
            }
            if object
                .get("channel_id")
                .is_none_or(serde_json::Value::is_null)
            {
                object.insert("channel_id".into(), channel_id.into());
            }
        }
    }
    let icons = avatar.map(|icon| std::collections::HashMap::from([(channel.to_string(), icon)]));
    let videos = search::parse_entries(&page_entries, icons.as_ref());
    Ok(ChannelVideosResult {
        videos,
        page,
        has_next,
        elapsed_ms: started.elapsed().as_millis() as u64,
    })
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
        "--extractor-args".into(),
        "youtubetab:approximate_date".into(),
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
    progress("登録チャンネル一覧を取得しています");
    let (mut channel_ids, mut channel_icons) =
        fetch_registered_channels(&yt, dir.path(), cancel, deadline)?;
    channel_ids.extend(extract_channel_ids(&entries));
    channel_icons.extend(extract_channel_icons(&entries));
    let videos = search::parse_entries(&entries, Some(&channel_icons));
    Ok(SubscriptionsResult {
        videos,
        channel_icons,
        channel_ids,
        elapsed_ms: started.elapsed().as_millis() as u64,
    })
}

fn fetch_registered_channels(
    yt: &std::path::Path,
    cwd: &std::path::Path,
    cancel: &Arc<AtomicBool>,
    deadline: Instant,
) -> Result<
    (
        std::collections::HashMap<String, String>,
        std::collections::HashMap<String, String>,
    ),
    String,
> {
    let args = vec![
        "--ignore-config".into(),
        "--no-plugin-dirs".into(),
        "--no-cache-dir".into(),
        "--flat-playlist".into(),
        "--print".into(),
        "%(.{channel,channel_id,thumbnails})j".into(),
        "--socket-timeout".into(),
        "15".into(),
        "--retries".into(),
        "0".into(),
        "--cookies-from-browser".into(),
        COOKIE_BROWSER.into(),
        "--".into(),
        CHANNELS_URL.into(),
    ];
    let data = process::run(yt, &args, cwd, vec![], cancel, deadline)?;
    let mut ids = std::collections::HashMap::new();
    let mut icons = std::collections::HashMap::new();
    for line in data
        .split(|byte| *byte == b'\n')
        .filter(|line| !line.is_empty())
    {
        let Ok(channel) = serde_json::from_slice::<serde_json::Value>(line) else {
            continue;
        };
        let Some(name) = channel.get("channel").and_then(serde_json::Value::as_str) else {
            continue;
        };
        let Some(id) = channel
            .get("channel_id")
            .and_then(serde_json::Value::as_str)
            .filter(|id| validate_channel_id(id).is_ok())
        else {
            continue;
        };
        ids.insert(name.to_string(), id.to_string());
        if let Some(icon) = extract_channel_avatar(&channel) {
            icons.insert(name.to_string(), icon);
        }
    }
    Ok((ids, icons))
}

fn extract_channel_ids(entries: &[serde_json::Value]) -> std::collections::HashMap<String, String> {
    entries
        .iter()
        .filter_map(|entry| {
            let channel = entry.get("channel")?.as_str()?;
            let id = entry.get("channel_id")?.as_str()?;
            validate_channel_id(id)
                .ok()
                .map(|_| (channel.to_string(), id.to_string()))
        })
        .collect()
}

fn extract_channel_icons(
    entries: &[serde_json::Value],
) -> std::collections::HashMap<String, String> {
    let mut icons = std::collections::HashMap::new();
    for entry in entries {
        let channel = entry
            .get("channel")
            .and_then(serde_json::Value::as_str)
            .unwrap_or_default();
        if channel.is_empty() || icons.contains_key(channel) {
            continue;
        }
        // Priority 1: channel_thumbnail (channel avatar from feed)
        if let Some(url) = entry
            .get("channel_thumbnail")
            .and_then(serde_json::Value::as_str)
        {
            icons.insert(channel.to_string(), url.to_string());
            continue;
        }
    }
    icons
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
        let videos = search::parse_entries(entries.as_array().unwrap(), None);
        assert_eq!(videos.len(), 2);
        assert_eq!(videos[0].id, "aaaaaaaaaaa");
        assert_eq!(videos[0].title, "新動画");
        assert_eq!(videos[1].id, "bbbbbbbbbbb");
        assert_eq!(videos[1].channel, "登録B");
    }

    #[test]
    fn extracts_valid_channel_ids_and_builds_pages() {
        let entries = serde_json::json!([
            {"channel": "登録A", "channel_id": "UC1234567890123456789012"},
            {"channel": "不正", "channel_id": "bad"}
        ]);
        let ids = extract_channel_ids(entries.as_array().unwrap());
        assert_eq!(ids.get("登録A").unwrap(), "UC1234567890123456789012");
        assert!(!ids.contains_key("不正"));
        assert_eq!(page_bounds(1).unwrap(), (1, 51));
        assert_eq!(page_bounds(2).unwrap(), (51, 101));
        assert!(page_bounds(0).is_err());
    }

    #[test]
    fn extracts_avatar_instead_of_channel_banner() {
        let channel = serde_json::json!({
            "thumbnails": [
                {"id": "banner_uncropped", "url": "https://yt3.googleusercontent.com/banner"},
                {"id": "avatar_uncropped", "url": "https://yt3.googleusercontent.com/avatar"}
            ]
        });
        assert_eq!(
            extract_channel_avatar(&channel).as_deref(),
            Some("https://yt3.googleusercontent.com/avatar")
        );
    }

    #[test]
    #[ignore = "Uses live YouTube"]
    fn live_video_details_include_description_and_avatar() {
        let video = search::Video {
            id: "BjhiGEsDLBM".into(),
            title: "動画".into(),
            channel: "ReHacQ".into(),
            description: String::new(),
            published_at: None,
            channel_icon: None,
            channel_id: Some("UCG_oqDSlIYEspNpd2H4zWhw".into()),
        };
        let hydrated = hydrate_video_blocking(video).unwrap();
        assert!(!hydrated.description.is_empty());
        assert!(hydrated
            .channel_icon
            .as_deref()
            .is_some_and(|url| url.starts_with("https://yt3.googleusercontent.com/")));
    }
}
