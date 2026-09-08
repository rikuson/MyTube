use std::{
    collections::HashSet,
    io::{Read, Write},
    net::{TcpListener, TcpStream},
    sync::{Arc, Mutex},
    time::Duration,
};

// A real HTTP document supplies the Referer that a tauri:// iframe cannot.
// Only player HTML is served; video traffic goes directly to YouTube.
pub struct PlayerServer {
    origin: String,
    videos: Arc<Mutex<HashSet<String>>>,
}

impl PlayerServer {
    pub fn start() -> std::io::Result<Self> {
        let listener = TcpListener::bind(("127.0.0.1", 0))?;
        let origin = format!("http://{}", listener.local_addr()?);
        let videos = Arc::new(Mutex::new(HashSet::new()));
        let allowed = videos.clone();
        let server_origin = origin.clone();
        std::thread::spawn(move || {
            for mut stream in listener.incoming().flatten() {
                let _ = serve(&mut stream, &server_origin, &allowed);
            }
        });
        Ok(Self { origin, videos })
    }

    pub fn url(&self, id: &str) -> Result<String, String> {
        if id.len() != 11
            || !id
                .bytes()
                .all(|c| c.is_ascii_alphanumeric() || c == b'_' || c == b'-')
        {
            return Err("動画IDが不正です。".into());
        }
        self.videos
            .lock()
            .map_err(|_| "プレイヤーを初期化できません。")?
            .insert(id.into());
        Ok(format!("{}/player/{id}", self.origin))
    }
}

fn serve(
    stream: &mut TcpStream,
    origin: &str,
    videos: &Mutex<HashSet<String>>,
) -> std::io::Result<()> {
    stream.set_read_timeout(Some(Duration::from_secs(2)))?;
    stream.set_write_timeout(Some(Duration::from_secs(2)))?;
    let mut request = Vec::new();
    let mut chunk = [0; 1024];
    while request.len() < 8192 && !request.windows(4).any(|part| part == b"\r\n\r\n") {
        let count = stream.read(&mut chunk)?;
        if count == 0 {
            break;
        }
        request.extend_from_slice(&chunk[..count]);
    }
    let request = String::from_utf8_lossy(&request);
    let mut parts = request
        .lines()
        .next()
        .unwrap_or_default()
        .split_whitespace();
    let method = parts.next();
    let id = parts.next().and_then(|path| path.strip_prefix("/player/"));
    let host = request.lines().find_map(|line| {
        let (key, value) = line.split_once(':')?;
        key.eq_ignore_ascii_case("host").then(|| value.trim())
    });
    let allowed = method == Some("GET")
        && host == origin.strip_prefix("http://")
        && id.is_some_and(|id| videos.lock().is_ok_and(|videos| videos.contains(id)));
    let (status, body) = if allowed {
        (
            "200 OK",
            include_str!("player_embed.html")
                .replace("__VIDEO_ID__", &serde_json::to_string(id.unwrap()).unwrap())
                .replace("__ORIGIN__", &serde_json::to_string(origin).unwrap()),
        )
    } else {
        ("404 Not Found", String::new())
    };
    write!(stream, "HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nReferrer-Policy: strict-origin-when-cross-origin\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n{body}", body.len())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn serves_only_registered_video_documents() {
        let server = PlayerServer::start().unwrap();
        assert!(server.url("<script>").is_err());
        let url = server.url("M7lc1UVf-VE").unwrap();
        for (path, expected) in [
            ("/player/M7lc1UVf-VE", "200 OK"),
            ("/player/abcdefghijk", "404 Not Found"),
            ("/../Cargo.toml", "404 Not Found"),
        ] {
            let host = server.origin.strip_prefix("http://").unwrap();
            let mut stream = TcpStream::connect(host).unwrap();
            write!(stream, "GET {path} HTTP/1.1\r\nHost: {host}\r\n\r\n").unwrap();
            let mut response = String::new();
            stream.read_to_string(&mut response).unwrap();
            assert!(response.starts_with(&format!("HTTP/1.1 {expected}")));
            if expected == "200 OK" {
                assert!(response.contains(&format!("const origin = {:?}", server.origin)));
                assert!(response.contains("Referrer-Policy: strict-origin-when-cross-origin"));
            }
        }
        assert!(url.starts_with("http://127.0.0.1:"));
    }
}
