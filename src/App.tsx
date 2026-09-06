import { useEffect, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { rankedVideos } from "./search";
import type { SearchResult, SearchStatus } from "./search";
import { Accordion, AccordionDetails, AccordionSummary, Alert, Box, Button, Card, CardContent, Chip, CircularProgress, Container, Divider, LinearProgress, Paper, Slider, Stack, Tab, Tabs, TextField, Typography } from "@mui/material";
import SearchRounded from "@mui/icons-material/SearchRounded";
import PlayArrowRounded from "@mui/icons-material/PlayArrowRounded";
import SubscriptionsRounded from "@mui/icons-material/SubscriptionsRounded";
import TuneRounded from "@mui/icons-material/TuneRounded";
import ExpandMoreRounded from "@mui/icons-material/ExpandMoreRounded";
import ArrowForwardRounded from "@mui/icons-material/ArrowForwardRounded";

function App() {
  const [tab, setTab] = useState<"search" | "channels">("search");
  const [query, setQuery] = useState("");
  const [weight, setWeight] = useState(70);
  const [opening, setOpening] = useState<string | null>(null);
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

  async function play(id: string) {
    if (opening) return;
    setOpening(id); setError("");
    try { await invoke("open_video", { id }); }
    catch (err) { setError(typeof err === "string" ? err : "再生画面を開けませんでした。"); }
    finally { setOpening(null); }
  }

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
    <Box sx={{ minHeight: "100vh" }}>
      <Box component="header" sx={{ borderBottom: 1, borderColor: "divider", bgcolor: "background.paper", px: { xs: 3, md: 5 }, py: 2.5 }}>
        <Stack direction="row" sx={{ alignItems: "center", justifyContent: "space-between" }}>
          <Stack direction="row" spacing={1.25} sx={{ alignItems: "center" }}>
            <Box sx={{ display: "grid", placeItems: "center", bgcolor: "primary.main", color: "white", width: 36, height: 36, borderRadius: 2.5 }}><PlayArrowRounded /></Box>
            <Typography variant="h6" sx={{ fontWeight: 800, letterSpacing: -0.8 }}>CodexTube</Typography>
          </Stack>
          <Chip label="見たい動画に、集中。" variant="outlined" size="small" sx={{ display: { xs: "none", sm: "flex" } }} />
        </Stack>
      </Box>
      <Container maxWidth="md" component="main" sx={{ py: { xs: 3, sm: 4 } }}>
        <Tabs value={tab} onChange={(_, value) => setTab(value)} aria-label="視聴の入口" sx={{ mb: 4 }}>
          <Tab icon={<SearchRounded fontSize="small" />} iconPosition="start" value="search" label="検索" />
          <Tab icon={<SubscriptionsRounded fontSize="small" />} iconPosition="start" value="channels" label="登録チャンネル" />
        </Tabs>
        {tab === "channels" ? <Paper variant="outlined" sx={{ p: 6, textAlign: "center" }}><SubscriptionsRounded sx={{ color: "text.secondary", fontSize: 40, mb: 2 }} /><Typography variant="h5" component="h1">登録チャンネル</Typography><Typography color="text.secondary" sx={{ mt: 2 }}>YouTubeアカウントとの同期は準備中です。</Typography></Paper> : <Stack spacing={3}>
          <Box><Typography variant="overline" color="primary" sx={{ fontWeight: 700, letterSpacing: 2 }}>YOUR FOCUS, YOUR VIDEOS</Typography><Typography component="h1" variant="h4" sx={{ fontWeight: 750, letterSpacing: -1, mt: 1, mb: 1.5 }}>見たい動画だけを、見つける。</Typography><Typography color="text.secondary" variant="body2">気になるテーマや除外したい条件を、自分の言葉で。</Typography></Box>
          <Paper component="form" onSubmit={event => { event.preventDefault(); void search(); }} variant="outlined" sx={{ p: { xs: 2.5, sm: 3 }, boxShadow: "0 12px 40px #18254306" }}>
            <TextField id="query" label="どんな動画が見たいですか？" value={query} onChange={event => setQuery(event.target.value)} multiline minRows={3} fullWidth disabled={busy} required slotProps={{ htmlInput: { maxLength: 1000 } }} placeholder="例：腕十字のやり方。初心者向けの実演が見たい" />
            <Stack direction="row" spacing={2} sx={{ alignItems: "center", justifyContent: "space-between", mt: 2.5 }}>
              <Typography variant="caption" color="text.secondary">タイトルや説明文から、条件に合う動画を選びます。</Typography>
              {busy ? <Button variant="outlined" disabled={cancelling} onClick={() => void cancel()} sx={{ flexShrink: 0 }}>{cancelling ? "キャンセル中…" : "キャンセル"}</Button> : <Button variant="contained" type="submit" size="large" endIcon={<ArrowForwardRounded />} disabled={!query.trim()} sx={{ flexShrink: 0 }}>動画を探す</Button>}
            </Stack>
          </Paper>
          <Accordion disableGutters elevation={0} sx={{ border: 1, borderColor: "divider", bgcolor: "transparent", "&:before": { display: "none" } }}>
            <AccordionSummary expandIcon={<ExpandMoreRounded />}><Stack direction="row" spacing={1.5} sx={{ alignItems: "center" }}><TuneRounded fontSize="small" color="action" /><Typography variant="body2" sx={{ fontWeight: 600 }}>並び順を調整</Typography><Chip size="small" label={`マッチ度 ${weight}%`} /></Stack></AccordionSummary>
            <AccordionDetails sx={{ px: 3 }}><Stack direction="row" sx={{ justifyContent: "space-between" }}><Typography variant="body2">おすすめ度 {100 - weight}%</Typography><Typography variant="body2">マッチ度 {weight}%</Typography></Stack><Slider value={weight} onChange={(_, value) => setWeight(value as number)} min={0} max={100} step={10} valueLabelDisplay="auto" aria-label="マッチ度の重み" /><Typography variant="caption" color="text.secondary">おすすめ度は動画情報から推定した目的への有用性です。条件に合う動画の中で並び替えます。</Typography></AccordionDetails>
          </Accordion>
          {busy && <Paper variant="outlined" sx={{ p: 3 }} role="status"><Stack direction="row" spacing={1.5} sx={{ alignItems: "center" }}><CircularProgress size={18} /><Typography variant="body2">{cancelling ? "検索を停止しています" : phase}</Typography></Stack><LinearProgress sx={{ mt: 2, borderRadius: 2 }} /><Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1.5 }}>検索には数分かかる場合があります。</Typography></Paper>}
          {error && <Alert severity="error">{error}</Alert>}
          {result && <Box component="section" aria-label="検索結果">
            <Stack direction="row" sx={{ alignItems: "center", justifyContent: "space-between", mb: 2 }}><Stack direction="row" spacing={1} sx={{ alignItems: "center" }}><Typography variant="h6" component="h2" sx={{ fontWeight: 700 }}>検索結果</Typography><Chip size="small" color="primary" label={`${videos.length}件`} /></Stack><Typography variant="caption" color="text.secondary">候補 {result.scanned}件 · 評価対象 {result.evaluated}件</Typography></Stack>
            {videos.length === 0 ? <Alert severity="info">{result.scanned > 0 && result.evaluated === 0 ? "評価できる動画情報がありませんでした。" : "条件に合う動画が見つかりませんでした。"} 検索条件を変えてお試しください。</Alert> : <Stack spacing={2}>{videos.map(video => <Card component="article" variant="outlined" key={video.id}><CardContent sx={{ p: 3, "&:last-child": { pb: 3 } }}>
              <Stack direction="row" spacing={2} sx={{ alignItems: "start", justifyContent: "space-between" }}><Box><Typography variant="caption" color="text.secondary">{video.channel}</Typography><Typography variant="h6" component="h3" sx={{ mt: 0.5, lineHeight: 1.5, fontWeight: 700, overflowWrap: "anywhere" }}>{video.title}</Typography></Box><Chip color="primary" variant="outlined" label={`総合 ${video.score.toFixed(0)}`} /></Stack>
              <Typography variant="body2" color="text.secondary" sx={{ my: 2, lineHeight: 1.8 }}>{video.reason}</Typography>
              <Stack direction="row" spacing={1} sx={{ mb: 2 }}><Chip size="small" label={`マッチ度 ${video.match_score}`} /><Chip size="small" label={`おすすめ度 ${video.recommendation_score}`} /></Stack>
              <Box component="details" sx={{ fontSize: 13, color: "text.secondary", "& summary": { cursor: "pointer" }, mb: 2 }}><summary>選ばれた理由を確認</summary><Box component="blockquote" sx={{ ml: 0, pl: 2, borderLeft: 2, borderColor: "divider", lineHeight: 1.8 }}>{video.evidence}</Box></Box>
              <Divider sx={{ mb: 2 }} /><Button variant="contained" startIcon={<PlayArrowRounded />} disabled={opening !== null} onClick={() => void play(video.id)}>{opening === video.id ? "開いています…" : "アプリ内で再生"}</Button>
            </CardContent></Card>)}</Stack>}
          </Box>}
          {!busy && !result && !error && <Box sx={{ textAlign: "center", py: 3, color: "text.secondary" }}><SearchRounded sx={{ fontSize: 34, color: "primary.light", mb: 1 }} /><Typography variant="body2">見たいものが決まったら、検索から。</Typography><Typography variant="caption">おすすめフィードはありません。</Typography></Box>}
        </Stack>}
      </Container>
    </Box>
  );
}
export default App;
