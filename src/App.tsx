import { useEffect, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { rankedVideos } from "./search";
import type { SearchResult, SearchStatus } from "./search";
import "./App.css";

function App() {
  const [tab, setTab] = useState<"search" | "channels">("search");
  const [query, setQuery] = useState("");
  const [weight, setWeight] = useState(70);
  const [busy, setBusy] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [phase, setPhase] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState<SearchResult | null>(null);
  const active = useRef<{ id: number | null; cancelled: boolean } | null>(null);

  useEffect(() => () => {
    const job = active.current;
    active.current = null;
    if (job) {
      job.cancelled = true;
      if (job.id !== null) void invoke("cancel_search", { id: job.id }).catch(() => {});
    }
  }, []);

  async function search() {
    if (active.current || !query.trim()) return;
    setError(""); setResult(null);
    if (!isTauri()) {
      setError("検索はデスクトップアプリで利用できます。");
      return;
    }
    const job = { id: null as number | null, cancelled: false };
    active.current = job;
    setBusy(true); setCancelling(false); setPhase("検索を開始しています");
    try {
      job.id = await invoke<number>("start_search", { query: query.trim() });
      if (job.cancelled) await invoke("cancel_search", { id: job.id });
      while (active.current === job) {
        const status = await invoke<SearchStatus>("search_status", { id: job.id });
        if (active.current !== job) return;
        setPhase(status.phase);
        if (status.finished) {
          if (job.cancelled) setError("検索をキャンセルしました。");
          else if (status.error) setError(status.error);
          else if (!job.cancelled) setResult(status.result);
          break;
        }
        await new Promise(resolve => setTimeout(resolve, 400));
      }
    } catch (err) {
      if (job.id !== null) void invoke("cancel_search", { id: job.id }).catch(() => {});
      if (active.current === job) setError(typeof err === "string" ? err : "検索に失敗しました。再試行してください。");
    } finally {
      if (active.current === job) { active.current = null; setBusy(false); setCancelling(false); }
    }
  }
  async function cancel() {
    const job = active.current;
    if (!job) return;
    job.cancelled = true; setCancelling(true);
    if (job.id !== null) {
      try { await invoke("cancel_search", { id: job.id }); }
      catch { setError("キャンセルを送信できませんでした。もう一度お試しください。"); setCancelling(false); }
    }
  }
  const videos = rankedVideos(result?.videos ?? [], weight);
  return (
    <div className="app">
      <header>
        <div className="brand"><span className="brand-mark" aria-hidden="true">▶</span> CodexTube</div>
        <span className="tagline">見たいものを、選んで見る。</span>
      </header>
      <nav aria-label="視聴の入口">
        <button aria-current={tab === "search" ? "page" : undefined} onClick={() => setTab("search")}>検索</button>
        <button aria-current={tab === "channels" ? "page" : undefined} onClick={() => setTab("channels")}>登録チャンネル</button>
      </nav>
      <main>
        {tab === "channels" ? <section className="empty"><h1>登録チャンネル</h1><p>YouTubeアカウントとの同期は準備中です。</p></section> : <>
          <section className="intro"><span className="eyebrow">意図から探す</span><h1>どんな動画が見たいですか？</h1><p>タイトルや説明文から、条件に合う動画だけを見つけます。</p></section>
          <form onSubmit={event => { event.preventDefault(); void search(); }}>
            <label htmlFor="query">見たい内容・除外したい条件</label>
            <textarea id="query" value={query} onChange={event => setQuery(event.target.value)} maxLength={1000} disabled={busy} required placeholder="例：パン作りの初心者向け解説。ホームベーカリーを使う動画は除外" rows={3} />
            <div className="form-footer"><span>字幕の有無にかかわらず検索します。</span>
              {busy ? <button type="button" disabled={cancelling} onClick={() => void cancel()}>{cancelling ? "キャンセル中…" : "キャンセル"}</button> : <button className="primary" type="submit" disabled={!query.trim()}>動画を探す <span aria-hidden="true">→</span></button>}
            </div>
          </form>
          <details className="preferences"><summary>並び順の調整</summary>
            <label htmlFor="weight">マッチ度 {weight}% ／ おすすめ度 {100 - weight}%</label>
            <input id="weight" type="range" min="0" max="100" step="10" value={weight} onChange={event => setWeight(Number(event.target.value))} />
            <p>おすすめ度は動画情報から推定した目的への有用性を評価します。条件に合う動画の中で並び替えます。</p>
          </details>
          {busy && <div className="progress" role="status"><span className="spinner" aria-hidden="true" />{cancelling ? "検索を停止しています" : phase}<small>内容の確認には数分かかる場合があります。</small></div>}
          {error && <p className="error" role="alert">{error}</p>}
          {result && <section aria-label="検索結果">
            <div className="results-heading"><h2>条件に合う動画 <span>{videos.length}</span></h2><small>候補 {result.scanned}件 · 評価対象 {result.evaluated}件</small></div>
            {videos.length === 0 ? <div className="empty"><h3>{result.scanned > 0 && result.evaluated === 0 ? "評価できる動画情報がありませんでした" : "条件に合う動画が見つかりませんでした"}</h3><p>検索条件を変えて、もう一度お試しください。</p></div> : videos.map(video => <article key={video.id} className="video">
              <div className="video-heading"><div><small>{video.channel}</small><h3>{video.title}</h3></div><span className="score">{video.score.toFixed(0)}<small>総合</small></span></div>
              <p>{video.reason}</p><div className="metrics"><span>マッチ度 {video.match_score}</span><span>おすすめ度 {video.recommendation_score}</span></div>
              <details><summary>動画情報の評価根拠</summary><blockquote>{video.evidence}</blockquote></details>
              <p className="playback-note">アプリ内再生は準備中です。</p>
            </article>)}
          </section>}
          {!busy && !result && !error && <div className="empty initial"><span aria-hidden="true">⌕</span><p>見たい内容を、自分の言葉で。<br />検索するまで動画は表示されません。</p></div>}
        </>}
      </main>
    </div>
  );
}
export default App;
