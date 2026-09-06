use std::{
    io::{Read, Write},
    os::unix::{fs::PermissionsExt, process::CommandExt},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    thread,
    time::{Duration, Instant},
};

fn executable_dirs() -> Vec<PathBuf> {
    let mut dirs: Vec<PathBuf> =
        std::env::split_paths(&std::env::var_os("PATH").unwrap_or_default()).collect();
    dirs.extend([
        PathBuf::from("/opt/homebrew/bin"),
        PathBuf::from("/usr/local/bin"),
    ]);
    dirs.into_iter().filter(|p| p.is_absolute()).collect()
}

pub fn executable(name: &str) -> Result<PathBuf, String> {
    executable_dirs()
        .into_iter()
        .map(|p| p.join(name))
        .find(|p| {
            p.is_file()
                && p.metadata()
                    .is_ok_and(|m| m.permissions().mode() & 0o111 != 0)
        })
        .ok_or_else(|| format!("{name}が見つかりません。インストールしてから再試行してください。"))
}

struct Running(Child);
impl Drop for Running {
    fn drop(&mut self) {
        // Each child starts its own process group; stop descendants as well.
        unsafe {
            libc::kill(-(self.0.id() as i32), libc::SIGKILL);
        }
        let _ = self.0.wait();
    }
}

fn drain(mut pipe: impl Read, limit: usize) -> std::io::Result<Vec<u8>> {
    let mut result = Vec::new();
    let mut buf = [0; 8192];
    loop {
        let count = pipe.read(&mut buf)?;
        if count == 0 {
            return Ok(result);
        }
        if result.len() + count > limit {
            return Err(std::io::Error::other("output limit exceeded"));
        }
        result.extend_from_slice(&buf[..count]);
    }
}

pub fn run(
    program: &Path,
    args: &[String],
    cwd: &Path,
    input: Vec<u8>,
    cancel: &Arc<AtomicBool>,
    deadline: Instant,
) -> Result<Vec<u8>, String> {
    if cancel.load(Ordering::SeqCst) {
        return Err("検索をキャンセルしました。".into());
    }
    let mut child = Running(
        Command::new(program)
            .args(args)
            .current_dir(cwd)
            .env(
                "PATH",
                std::env::join_paths(executable_dirs())
                    .map_err(|_| "実行パスを準備できません。")?,
            )
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .process_group(0)
            .spawn()
            .map_err(|_| {
                "外部ツールを起動できませんでした。インストール状態を確認してください。"
            })?,
    );
    let mut stdin = child.0.stdin.take().unwrap();
    let stdout = child.0.stdout.take().unwrap();
    let stderr = child.0.stderr.take().unwrap();
    let writer = thread::spawn(move || stdin.write_all(&input));
    let reader = thread::spawn(move || drain(stdout, 4 * 1024 * 1024));
    // Drain diagnostics but never send raw output (possibly sensitive) to the UI.
    let errors = thread::spawn(move || drain(stderr, 1024 * 1024));
    let status = loop {
        if cancel.load(Ordering::SeqCst) {
            return Err("検索をキャンセルしました。".into());
        }
        if Instant::now() >= deadline {
            return Err("検索が時間制限を超えました。条件を絞って再試行してください。".into());
        }
        if let Some(status) = child
            .0
            .try_wait()
            .map_err(|_| "実行状態を確認できませんでした。")?
        {
            break status;
        }
        thread::sleep(Duration::from_millis(50));
    };
    // Kill lingering descendants before joining pipe readers.
    drop(child);
    let output = reader
        .join()
        .map_err(|_| "出力を読み取れませんでした。")?
        .map_err(|_| "出力が大きすぎるか、読み取りに失敗しました。")?;
    let stderr_bytes = errors
        .join()
        .map_err(|_| "診断出力を読み取れませんでした。")?
        .map_err(|_| "診断出力が上限を超えました。")?;
    let stdin_ok = writer.join().map_err(|_| "入力を渡せませんでした。")?;
    if !status.success() {
        let stderr_str = String::from_utf8_lossy(&stderr_bytes).trim().to_string();
        return Err(format!(
            "{}の実行に失敗しました。{}",
            program.file_name().unwrap_or_default().to_string_lossy(),
            if stderr_str.is_empty() {
                "接続・ログイン状態・対応バージョンを確認して再試行してください。".into()
            } else {
                format!("詳細: {}", stderr_str)
            }
        ));
    }
    stdin_ok.map_err(|_| "入力を渡せませんでした。")?;
    Ok(output)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn cancellation_and_timeout_stop_processes() {
        let dir = tempfile::tempdir().unwrap();
        for cancelled in [true, false] {
            let cancel = Arc::new(AtomicBool::new(cancelled));
            let start = Instant::now();
            let result = run(
                Path::new("/bin/sleep"),
                &["10".into()],
                dir.path(),
                vec![],
                &cancel,
                start + Duration::from_millis(100),
            );
            assert!(result.is_err());
            assert!(start.elapsed() < Duration::from_secs(2));
        }
    }
    #[test]
    fn cancellation_during_execution_stops_promptly() {
        let dir = tempfile::tempdir().unwrap();
        let cancel = Arc::new(AtomicBool::new(false));
        let signal = cancel.clone();
        let sender = thread::spawn(move || {
            thread::sleep(Duration::from_millis(100));
            signal.store(true, Ordering::SeqCst);
        });
        let start = Instant::now();
        let result = run(
            Path::new("/bin/sleep"),
            &["10".into()],
            dir.path(),
            vec![],
            &cancel,
            start + Duration::from_secs(10),
        );
        sender.join().unwrap();
        assert!(result.unwrap_err().contains("キャンセル"));
        assert!(start.elapsed() < Duration::from_secs(2));
    }
    #[test]
    fn stdin_is_data_and_failure_is_not_success() {
        let dir = tempfile::tempdir().unwrap();
        let cancel = Arc::new(AtomicBool::new(false));
        let payload = b"$(touch /tmp/do-not-execute)\nquotes ' and \"";
        assert_eq!(
            run(
                Path::new("/bin/cat"),
                &[],
                dir.path(),
                payload.to_vec(),
                &cancel,
                Instant::now() + Duration::from_secs(2)
            )
            .unwrap(),
            payload
        );
        assert!(run(
            Path::new("/usr/bin/false"),
            &[],
            dir.path(),
            vec![],
            &cancel,
            Instant::now() + Duration::from_secs(2)
        )
        .is_err());
    }
}
