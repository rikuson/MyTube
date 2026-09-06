import { useEffect, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import type { SearchResult, SearchStatus, SubscriptionsResult, SubscriptionsStatus, Video } from "./search";
import { Alert, Box, Button, Card, CardContent, CircularProgress, Container, Divider, LinearProgress, Paper, Stack, Tab, Tabs, TextField, Typography } from "@mui/material";
import SearchRounded from "@mui/icons-material/SearchRounded";
import PlayArrowRounded from "@mui/icons-material/PlayArrowRounded";
import SubscriptionsRounded from "@mui/icons-material/SubscriptionsRounded";
import ArrowForwardRounded from "@mui/icons-material/ArrowForwardRounded";

function App() {
  const [tab, setTab] = useState<"search" | "channels">("search");
  const [query, setQuery] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [requestedPage, setRequestedPage] = useState(1);
  const [opening, setOpening] = useState<string | null>(null);
  const [searchBusy, setSearchBusy] = useState(false);
  const [searchCancelling, setSearchCancelling] = useState(false);
  const [searchPhase, setSearchPhase] = useState("");
  const [searchError, setSearchError] = useState("");
  const [searchResult, setSearchResult] = useState<SearchResult | null>(null);
  const searchActive = useRef<{ id: number | null; cancelled: boolean } | null>(null);

  const [channelBusy, setChannelBusy] = useState(false);
  const [channelPhase, setChannelPhase] = useState("");
  const [channelError, setChannelError] = useState("");
  const [channelResult, setChannelResult] = useState<SubscriptionsResult | null>(null);
  const channelActive = useRef<{ id: number | null; cancelled: boolean } | null>(null);

  useEffect(() => () => {
    const job = searchActive.current;
    searchActive.current = null;
    if (job) {
      job.cancelled = true;
      if (job.id !== null) void invoke("cancel_search", { id: job.id }).catch(() => {});
    }
    const channelJob = channelActive.current;
    channelActive.current = null;
    if (channelJob) {
      channelJob.cancelled = true;
      if (channelJob.id !== null) void invoke("cancel_subscriptions", { id: channelJob.id }).catch(() => {});
    }
  }, []);

  useEffect(() => {
    if (tab !== "channels") return;
    if (channelResult || channelBusy || channelError) return;
    void syncChannels();
  }, [tab]);

  async function play(id: string) {
    if (opening) return;
    setOpening(id); setSearchError(""); setChannelError("");
    try { await invoke("open_video", { id }); }
    catch (err) { const message = typeof err === "string" ? err : "再生画面を開けませんでした。"; setSearchError(message); setChannelError(message); }
    finally { setOpening(null); }
  }

  async function search(page = 1, text = query) {
    if (searchActive.current || !text.trim()) return;
    setSubmittedQuery(text.trim()); setRequestedPage(page);
    setSearchError(""); setSearchResult(null);
    if (!isTauri()) {
      setSearchError("検索はデスクトップアプリで利用できます。");
      return;
    }
    const job = { id: null as number | null, cancelled: false };
    searchActive.current = job;
    setSearchBusy(true); setSearchCancelling(false); setSearchPhase("検索を開始しています");
    try {
      job.id = await invoke<number>("start_search", { query: text.trim(), page });
      if (job.cancelled) await invoke("cancel_search", { id: job.id });
      while (searchActive.current === job) {
        const status = await invoke<SearchStatus>("search_status", { id: job.id });
        if (searchActive.current !== job) return;
        setSearchPhase(status.phase);
        if (status.finished) {
          if (job.cancelled) setSearchError("検索をキャンセルしました。");
          else if (status.error) setSearchError(status.error);
          else if (!job.cancelled) setSearchResult(status.result);
          break;
        }
        await new Promise(resolve => setTimeout(resolve, 400));
      }
    } catch (err) {
      if (job.id !== null) void invoke("cancel_search", { id: job.id }).catch(() => {});
      if (searchActive.current === job) setSearchError(typeof err === "string" ? err : "検索に失敗しました。再試行してください。");
    } finally {
      if (searchActive.current === job) { searchActive.current = null; setSearchBusy(false); setSearchCancelling(false); }
    }
  }
  async function cancelSearch() {
    const job = searchActive.current;
    if (!job) return;
    job.cancelled = true; setSearchCancelling(true);
    if (job.id !== null) {
      try { await invoke("cancel_search", { id: job.id }); }
      catch { setSearchError("キャンセルを送信できませんでした。もう一度お試しください。"); setSearchCancelling(false); }
    }
  }

  async function syncChannels() {
    if (channelActive.current) return;
    setChannelError(""); setChannelResult(null);
    if (!isTauri()) {
      setChannelError("登録チャンネルの同期はデスクトップアプリで利用できます。");
      return;
    }
    const job = { id: null as number | null, cancelled: false };
    channelActive.current = job;
    setChannelBusy(true); setChannelPhase("登録チャンネルを取得しています");
    try {
      job.id = await invoke<number>("sync_subscriptions");
      if (job.cancelled) await invoke("cancel_subscriptions", { id: job.id });
      while (channelActive.current === job) {
        const status = await invoke<SubscriptionsStatus>("subscriptions_status", { id: job.id });
        if (channelActive.current !== job) return;
        setChannelPhase(status.phase);
        if (status.finished) {
          if (job.cancelled) setChannelError("同期をキャンセルしました。");
          else if (status.error) setChannelError(status.error);
          else if (!job.cancelled) setChannelResult(status.result);
          break;
        }
        await new Promise(resolve => setTimeout(resolve, 400));
      }
    } catch (err) {
      if (job.id !== null) void invoke("cancel_subscriptions", { id: job.id }).catch(() => {});
      if (channelActive.current === job) setChannelError(typeof err === "string" ? err : "同期に失敗しました。再試行してください。");
    } finally {
      if (channelActive.current === job) { channelActive.current = null; setChannelBusy(false); }
    }
  }

  const searchVideos = searchResult?.videos ?? [];
  const channelVideos = channelResult?.videos ?? [];
  return (
    <Box sx={{ minHeight: "100vh" }}>
      <Box component="header" sx={{ borderBottom: 1, borderColor: "divider", bgcolor: "background.paper", px: { xs: 3, md: 5 }, py: 2.5 }}>
        <Stack direction="row" sx={{ alignItems: "center", justifyContent: "space-between" }}>
          <Stack direction="row" spacing={1.25} sx={{ alignItems: "center" }}>
            <Box sx={{ display: "grid", placeItems: "center", bgcolor: "primary.main", color: "white", width: 36, height: 36, borderRadius: 2.5 }}><PlayArrowRounded /></Box>
            <Typography variant="h6" sx={{ fontWeight: 800, letterSpacing: -0.8 }}>CodexTube</Typography>
          </Stack>
        </Stack>
      </Box>
      <Container maxWidth="md" component="main" sx={{ py: { xs: 3, sm: 4 } }}>
        <Tabs value={tab} onChange={(_, value) => setTab(value)} sx={{ mb: 4 }}>
          <Tab icon={<SearchRounded fontSize="small" />} iconPosition="start" value="search" label="検索" />
          <Tab icon={<SubscriptionsRounded fontSize="small" />} iconPosition="start" value="channels" label="登録チャンネル" />
        </Tabs>
        {tab === "channels" ? <Stack spacing={3}>
          {channelBusy && <Paper variant="outlined" sx={{ p: 3 }} role="status"><Stack direction="row" spacing={1.5} sx={{ alignItems: "center" }}><CircularProgress size={18} /><Typography variant="body2">{channelPhase}</Typography></Stack><LinearProgress sx={{ mt: 2, borderRadius: 2 }} /></Paper>}
          {channelError && <Alert severity="error" action={<Button color="inherit" size="small" onClick={() => void syncChannels()}>再試行</Button>}>{channelError}</Alert>}
          {channelResult && <Box component="section" aria-label="登録チャンネルの動画">
            <Stack direction="row" sx={{ alignItems: "center", justifyContent: "space-between", mb: 2 }}><Typography variant="body2" color="text.secondary">{(channelResult.elapsed_ms / 1000).toFixed(1)}秒</Typography></Stack>
            {channelVideos.length === 0 ? <Alert severity="info">登録チャンネルに新しい動画がありません。</Alert> : <Stack spacing={2}>{channelVideos.map(video => <ChannelVideoCard key={video.id} video={video} opening={opening} onPlay={() => void play(video.id)} />)}</Stack>}
          </Box>}
        </Stack> : <Stack spacing={3}>
          <Paper component="form" onSubmit={event => { event.preventDefault(); void search(); }} variant="outlined" sx={{ p: { xs: 2.5, sm: 3 } }}>
            <TextField id="query" label="検索" value={query} onChange={event => setQuery(event.target.value)} multiline minRows={3} fullWidth disabled={searchBusy} required slotProps={{ htmlInput: { maxLength: 1000 } }} placeholder="例：腕十字 やり方" />
            <Stack direction="row" spacing={2} sx={{ alignItems: "center", justifyContent: "flex-end", mt: 2.5 }}>
              {searchBusy ? <Button variant="outlined" disabled={searchCancelling} onClick={() => void cancelSearch()} sx={{ flexShrink: 0 }}>{searchCancelling ? "キャンセル中…" : "キャンセル"}</Button> : <Button variant="contained" type="submit" endIcon={<ArrowForwardRounded />} disabled={!query.trim()} sx={{ flexShrink: 0 }}>検索</Button>}
            </Stack>
          </Paper>
          {searchBusy && <Paper variant="outlined" sx={{ p: 3 }} role="status"><Stack direction="row" spacing={1.5} sx={{ alignItems: "center" }}><CircularProgress size={18} /><Typography variant="body2">{searchCancelling ? "検索を停止しています" : searchPhase}</Typography></Stack><LinearProgress sx={{ mt: 2, borderRadius: 2 }} /></Paper>}
          {searchError && <Alert severity="error" action={<Button color="inherit" size="small" onClick={() => void search(requestedPage, submittedQuery)}>再試行</Button>}>{searchError}</Alert>}
          {searchResult && <Box component="section" aria-label="検索結果">
            <Stack direction="row" spacing={2} sx={{ alignItems: "center", justifyContent: "center", my: 2 }}>
              <Button variant="outlined" disabled={searchBusy || searchResult.page <= 1} onClick={() => void search(searchResult.page - 1, submittedQuery)}>前の50件</Button>
              <Typography variant="body2">{searchResult.page}ページ</Typography>
              <Button variant="outlined" disabled={searchBusy || !searchResult.has_next} onClick={() => { void search(searchResult.page + 1, submittedQuery); window.scrollTo({ top: 0 }); }}>次の50件</Button>
            </Stack>
            <Stack direction="row" sx={{ alignItems: "center", justifyContent: "space-between", mb: 2 }}><Typography variant="body2" color="text.secondary">{(searchResult.elapsed_ms / 1000).toFixed(1)}秒</Typography></Stack>
            {searchVideos.length === 0 ? <Alert severity="info">動画が見つかりませんでした。 検索条件を変えてお試しください。</Alert> : <Stack spacing={2}>{searchVideos.map(video => <SearchVideoCard key={video.id} video={video} opening={opening} onPlay={() => void play(video.id)} />)}</Stack>}
            <Stack direction="row" spacing={2} sx={{ alignItems: "center", justifyContent: "center", my: 2 }}>
              <Button variant="outlined" disabled={searchBusy || searchResult.page <= 1} onClick={() => void search(searchResult.page - 1, submittedQuery)}>前の50件</Button>
              <Typography variant="body2">{searchResult.page}ページ</Typography>
              <Button variant="outlined" disabled={searchBusy || !searchResult.has_next} onClick={() => { void search(searchResult.page + 1, submittedQuery); window.scrollTo({ top: 0 }); }}>次の50件</Button>
            </Stack>
          </Box>}
          {!searchBusy && !searchResult && !searchError && <Box sx={{ textAlign: "center", py: 3, color: "text.secondary" }}><Typography variant="body2">検索条件を入力してください。</Typography></Box>}
        </Stack>}
      </Container>
    </Box>
  );
}

function VideoCard({ video, opening, onPlay }: { video: Video; opening: string | null; onPlay: () => void }) {
  return (
    <Card component="article" variant="outlined"><CardContent sx={{ p: 3, "&:last-child": { pb: 3 } }}>
      <Stack direction="row" spacing={2} sx={{ alignItems: "start", justifyContent: "space-between" }}><Box><Typography variant="caption" color="text.secondary">{video.channel}</Typography><Typography variant="h6" component="h3" sx={{ mt: 0.5, lineHeight: 1.5, fontWeight: 700, overflowWrap: "anywhere" }}>{video.title}</Typography></Box></Stack>
      {video.description && <Typography variant="body2" color="text.secondary" sx={{ my: 2, lineHeight: 1.8, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{video.description}</Typography>}
      <Divider sx={{ mb: 2 }} /><Button variant="contained" startIcon={<PlayArrowRounded />} disabled={opening !== null} onClick={onPlay}>{opening === video.id ? "開いています…" : "アプリ内で再生"}</Button>
    </CardContent></Card>
  );
}

function SearchVideoCard(props: { video: Video; opening: string | null; onPlay: () => void }) {
  return <VideoCard {...props} />;
}

function ChannelVideoCard(props: { video: Video; opening: string | null; onPlay: () => void }) {
  return <VideoCard {...props} />;
}
export default App;