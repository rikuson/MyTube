import { useEffect, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import type { ChannelVideosResult, SearchResult, SearchStatus, SubscriptionsResult, SubscriptionsStatus, Video } from "./search";
import { Alert, Avatar, Box, Button, CircularProgress, Container, LinearProgress, Paper, Stack, TextField, Typography, IconButton } from "@mui/material";
import { SearchRounded, PlayArrowRounded, CloseRounded } from "@mui/icons-material";

const initialParams = new URLSearchParams(window.location.search);
const initialChannelId = initialParams.get("channel")?.trim() || null;
const initialChannelName = initialParams.get("channelName")?.trim() || null;
const initialChannelIcon = initialParams.get("channelIcon")?.trim() || undefined;
const initialChannelRegistered = initialParams.get("registered") === "1";

function App() {
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
  const [selectedChannel, setSelectedChannel] = useState<string | null>(initialChannelName);
  const [channelPage, setChannelPage] = useState(1);
  const [channelVideosBusy, setChannelVideosBusy] = useState(false);
  const [channelVideosError, setChannelVideosError] = useState("");
  const [channelVideosResult, setChannelVideosResult] = useState<ChannelVideosResult | null>(null);
  const [requestedChannelId, setRequestedChannelId] = useState<string | null>(initialChannelId);
  const channelRequest = useRef(0);
  const directChannelStarted = useRef(false);
  const channelActive = useRef<{ id: number | null; cancelled: boolean } | null>(null);
  const [subscriptionOverrides, setSubscriptionOverrides] = useState<Record<string, boolean>>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("mytube-subscription-overrides") ?? "{}");
      const legacy = JSON.parse(localStorage.getItem("mytube-unsubscribed-channels") ?? "[]") as string[];
      const states = { ...Object.fromEntries(legacy.map(id => [id, false])), ...saved };
      if (initialChannelId && !(initialChannelId in states)) states[initialChannelId] = initialChannelRegistered;
      return states;
    } catch {
      return {};
    }
  });

  const isSearching = submittedQuery.trim().length > 0;

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
    const params = new URLSearchParams(window.location.search);
    const playerQuery = params.get("q")?.trim();
    const playerChannelId = params.get("channel")?.trim();
    if (!playerQuery && !playerChannelId) return;
    window.history.replaceState(null, "", window.location.pathname);
    if (playerQuery) {
      setQuery(playerQuery);
      void search(1, playerQuery);
    }
  }, []);

  useEffect(() => {
    if (isSearching) return;
    if (channelResult || channelBusy || channelError) return;
    void syncChannels();
  }, [isSearching, channelBusy, channelResult, channelError]);

  async function play(id: string) {
    if (opening) return;
    setOpening(id); setSearchError(""); setChannelError("");
    try { await invoke("open_video", { id }); }
    catch (err) { const message = typeof err === "string" ? err : "再生画面を開けませんでした。"; setSearchError(message); setChannelError(message); }
    finally { setOpening(null); }
  }

  async function search(page = 1, text = query) {
    const trimmed = text.trim();
    if (searchActive.current || !trimmed) return;
    setSubmittedQuery(trimmed); setRequestedPage(page);
    setSearchError(""); setSearchResult(null);
    if (!isTauri()) {
      setSearchError("検索はデスクトップアプリで利用できます。");
      return;
    }
    const job = { id: null as number | null, cancelled: false };
    searchActive.current = job;
    setSearchBusy(true); setSearchCancelling(false); setSearchPhase("検索を開始しています");
    try {
      job.id = await invoke<number>("start_search", { query: trimmed, page });
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

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    void search();
  }

  function handleClear() {
    setQuery("");
    setSubmittedQuery("");
    setSearchResult(null);
    setSearchError("");
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
  const channelIcons = channelResult?.channel_icons ?? {};
  const channelIds = channelResult?.channel_ids ?? {};
  const channels = Object.keys(channelIds).sort((a, b) => a.localeCompare(b, "ja"));
  const selectedChannelId = selectedChannel
    ? channelIds[selectedChannel] ?? (selectedChannel === initialChannelName ? initialChannelId : null)
    : null;
  const selectedChannelRegisteredByAccount = selectedChannel
    ? Object.prototype.hasOwnProperty.call(channelIds, selectedChannel)
      || (selectedChannel === initialChannelName && initialChannelRegistered)
    : false;
  const selectedChannelRegistered = selectedChannelId
    ? subscriptionOverrides[selectedChannelId] ?? selectedChannelRegisteredByAccount
    : false;
  const visibleChannelVideos = selectedChannel ? (channelVideosResult?.videos ?? []) : channelVideos;

  useEffect(() => {
    if (!requestedChannelId || !channelResult) return;
    if (selectedChannel && channelIds[selectedChannel] === requestedChannelId) {
      setRequestedChannelId(null);
      return;
    }
    const channel = Object.entries(channelIds).find(([, id]) => id === requestedChannelId)?.[0];
    if (channel) selectChannel(channel);
    setRequestedChannelId(null);
  }, [requestedChannelId, channelResult]);

  useEffect(() => {
    if (!requestedChannelId || !selectedChannel || directChannelStarted.current) return;
    directChannelStarted.current = true;
    void loadChannelVideos(selectedChannel, 1, requestedChannelId);
  }, [requestedChannelId, selectedChannel]);

  useEffect(() => {
    if (channelResult && selectedChannel && !channels.includes(selectedChannel)) setSelectedChannel(null);
    setChannelPage(1);
  }, [channelResult, selectedChannel]);

  function selectChannel(channel: string | null) {
    channelRequest.current += 1;
    setSelectedChannel(channel);
    setChannelPage(1);
    setChannelVideosResult(null);
    setChannelVideosError("");
    setChannelVideosBusy(false);
    if (channel) void loadChannelVideos(channel, 1);
  }

  async function loadChannelVideos(channel: string, page: number, directChannelId?: string) {
    const channelId = directChannelId ?? channelIds[channel];
    if (!channelId) {
      setChannelVideosError("チャンネルIDを取得できませんでした。");
      return;
    }
    const request = ++channelRequest.current;
    setChannelVideosBusy(true);
    setChannelVideosError("");
    setChannelVideosResult(null);
    try {
      const result = await invoke<ChannelVideosResult>("fetch_channel_videos", { channelId, page });
      if (channelRequest.current !== request) return;
      setChannelPage(result.page);
      setChannelVideosResult(result);
    } catch (err) {
      if (channelRequest.current === request) setChannelVideosError(typeof err === "string" ? err : "チャンネル動画を取得できませんでした。");
    } finally {
      if (channelRequest.current === request) setChannelVideosBusy(false);
    }
  }

  function toggleChannelSubscription(channel: string, directChannelId?: string | null) {
    const channelId = directChannelId ?? channelIds[channel];
    if (!channelId) return;
    setSubscriptionOverrides(current => {
      const registered = current[channelId] ?? selectedChannelRegisteredByAccount;
      const next = { ...current, [channelId]: !registered };
      localStorage.setItem("mytube-subscription-overrides", JSON.stringify(next));
      return next;
    });
  }

  return (
    <Box sx={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      <Box component="header" sx={{ borderBottom: 1, borderColor: "divider", bgcolor: "background.paper", px: { xs: 3, md: 5 }, py: 2 }}>
        <Stack direction="row" spacing={2} sx={{ alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" }}>
          <Box
            onClick={() => {
              if (isSearching) {
                handleClear();
                void syncChannels();
              } else {
                void syncChannels();
              }
            }}
            sx={{ 
              display: "flex", 
              alignItems: "center", 
              gap: 1.25, 
              cursor: "pointer",
            }}
            aria-label={isSearching ? "検索をクリアして登録チャンネルを更新" : "登録チャンネルを更新"}
          >
            <Box sx={{ display: "grid", placeItems: "center", bgcolor: "primary.main", color: "white", width: 36, height: 36, borderRadius: 2.5 }}><PlayArrowRounded /></Box>
            <Typography variant="h6" sx={{ fontWeight: 800, letterSpacing: -0.8 }}>MyTube</Typography>
          </Box>
          <Box component="form" onSubmit={handleSubmit} sx={{ flex: 1, maxWidth: 600, mx: { xs: 0, sm: 4 } }}>
            <Stack direction="row" spacing={1} sx={{ alignItems: "center", width: "100%" }}>
              <TextField
                id="header-query"
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="検索…"
                size="small"
                fullWidth
                disabled={searchBusy}
                sx={{ minWidth: 0 }}
              />
              {submittedQuery.trim()
                ? <IconButton onClick={handleClear} size="small" aria-label="検索をクリア"><CloseRounded /></IconButton>
                : <IconButton type="submit" size="small" aria-label="検索" disabled={!query.trim() || searchBusy}><SearchRounded /></IconButton>}
            </Stack>
          </Box>
        </Stack>
      </Box>
      <Box sx={{ display: "flex", flex: 1 }}>
      {!isSearching && <Box component="aside" sx={{ display: { xs: "none", md: "block" }, flex: "0 0 250px", borderRight: 1, borderColor: "divider", px: 1.5, py: 2, overflowY: "auto", maxHeight: "calc(100vh - 69px)", position: "sticky", top: 0, alignSelf: "flex-start" }}>
        <Button fullWidth size="small" onClick={() => selectChannel(null)} sx={{ justifyContent: "flex-start", color: selectedChannel ? "text.primary" : "primary.main", bgcolor: selectedChannel ? "transparent" : "action.selected", mb: 0.75 }}>すべて</Button>
        <Stack spacing={0.25}>
          {channels.map(channel => (
            <Button
              key={channel}
              fullWidth
              size="small"
              onClick={() => selectChannel(channel)}
              sx={{
                justifyContent: "flex-start",
                color: selectedChannel === channel ? "primary.main" : "text.primary",
                bgcolor: selectedChannel === channel ? "action.selected" : "transparent",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
                gap: 1,
              }}
              startIcon={channelIcons[channel] && (
                <img
                  src={channelIcons[channel]}
                  alt=""
                  style={{ width: 20, height: 20, borderRadius: '50%', objectFit: 'cover' }}
                />
              )}
            >
              {channel}
            </Button>
          ))}
        </Stack>
      </Box>}
      <Container maxWidth="lg" component="main" sx={{ py: { xs: 3, sm: 4 }, flex: 1, minWidth: 0 }}>
        {isSearching ? (
          <Stack spacing={3}>
            {searchBusy && <Paper variant="outlined" sx={{ p: 3 }} role="status"><Stack direction="row" spacing={1.5} sx={{ alignItems: "center" }}><CircularProgress size={18} /><Typography variant="body2" sx={{ flex: 1 }}>{searchCancelling ? "検索を停止しています" : searchPhase}</Typography><Button variant="outlined" disabled={searchCancelling} onClick={() => void cancelSearch()} sx={{ flexShrink: 0 }}>{searchCancelling ? "キャンセル中…" : "キャンセル"}</Button></Stack><LinearProgress sx={{ mt: 2, borderRadius: 2 }} /></Paper>}
            {searchError && <Alert severity="error" action={<Button color="inherit" size="small" onClick={() => void search(requestedPage, submittedQuery)}>再試行</Button>}>{searchError}</Alert>}
            {searchResult && <Box component="section" aria-label="検索結果">
              <Stack direction="row" sx={{ alignItems: "center", justifyContent: "space-between", mb: 2 }}><Typography variant="body2" color="text.secondary">{(searchResult.elapsed_ms / 1000).toFixed(1)}秒</Typography></Stack>
              {searchVideos.length === 0 ? <Alert severity="info">動画が見つかりませんでした。 検索条件を変えてお試しください。</Alert> : <Stack spacing={2}>{searchVideos.map(video => <VideoCard key={video.id} video={video} opening={opening} onPlay={() => void play(video.id)} />)}</Stack>}
              <Stack direction="row" spacing={2} sx={{ alignItems: "center", justifyContent: "center", my: 2 }}>
                <Button variant="outlined" disabled={searchBusy || searchResult.page <= 1} onClick={() => void search(searchResult.page - 1, submittedQuery)}>前の50件</Button>
                <Typography variant="body2">{searchResult.page}ページ</Typography>
                <Button variant="outlined" disabled={searchBusy || !searchResult.has_next} onClick={() => { void search(searchResult.page + 1, submittedQuery); window.scrollTo({ top: 0 }); }}>次の50件</Button>
              </Stack>
            </Box>}
            {!searchBusy && !searchResult && !searchError && <Box sx={{ textAlign: "center", py: 3, color: "text.secondary" }}><Typography variant="body2">検索条件を入力してください。</Typography></Box>}
          </Stack>
        ) : (
          <Stack spacing={3}>
            {selectedChannel && <Stack direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
              <Avatar src={channelIcons[selectedChannel] ?? (selectedChannel === initialChannelName ? initialChannelIcon : undefined)} alt="" sx={{ width: 44, height: 44 }}>{selectedChannel.slice(0, 1)}</Avatar>
              <Typography variant="h6" component="h2" sx={{ flex: 1, minWidth: 0, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{selectedChannel}</Typography>
              <Button
                variant={selectedChannelRegistered ? "outlined" : "contained"}
                onClick={() => toggleChannelSubscription(selectedChannel, selectedChannelId)}
                disabled={!selectedChannelId}
                sx={{ flexShrink: 0, borderRadius: 5, textTransform: "none" }}
              >
                {selectedChannelRegistered ? "登録解除" : "登録"}
              </Button>
            </Stack>}
            {channelBusy && !selectedChannel && <Paper variant="outlined" sx={{ p: 3 }} role="status"><Stack direction="row" spacing={1.5} sx={{ alignItems: "center" }}><CircularProgress size={18} /><Typography variant="body2">{channelPhase}</Typography></Stack><LinearProgress sx={{ mt: 2, borderRadius: 2 }} /></Paper>}
            {channelError && !selectedChannel && <Alert severity="error" action={<Button color="inherit" size="small" onClick={() => void syncChannels()}>再試行</Button>}>{channelError}</Alert>}
            {channelVideosBusy && <Paper variant="outlined" sx={{ p: 3 }} role="status"><Stack direction="row" spacing={1.5} sx={{ alignItems: "center" }}><CircularProgress size={18} /><Typography variant="body2">チャンネル動画を取得しています</Typography></Stack><LinearProgress sx={{ mt: 2, borderRadius: 2 }} /></Paper>}
            {channelVideosError && selectedChannel && <Alert severity="error" action={<Button color="inherit" size="small" onClick={() => void loadChannelVideos(selectedChannel, channelPage, selectedChannelId ?? undefined)}>再試行</Button>}>{channelVideosError}</Alert>}
            {(channelResult || selectedChannel) && <Box component="section" aria-label="登録チャンネルの動画">
              {!channelVideosBusy && !channelVideosError && (visibleChannelVideos.length === 0 ? <Alert severity="info">動画がありません。</Alert> : <Stack spacing={2}>{visibleChannelVideos.map(video => <VideoCard key={video.id} video={video} opening={opening} onPlay={() => void play(video.id)} />)}</Stack>)}
              {selectedChannel && channelVideosResult && <ChannelPagination page={channelPage} hasNext={channelVideosResult.has_next} onPrevious={() => void loadChannelVideos(selectedChannel, channelPage - 1, selectedChannelId ?? undefined)} onNext={() => { void loadChannelVideos(selectedChannel, channelPage + 1, selectedChannelId ?? undefined); window.scrollTo({ top: 0 }); }} />}
            </Box>}
            {!selectedChannel && !channelBusy && !channelResult && !channelError && !isSearching && <Box sx={{ textAlign: "center", py: 6, color: "text.secondary" }}><Typography variant="body2">登録チャンネルを同期しています…</Typography></Box>}
          </Stack>
        )}
      </Container>
      </Box>
    </Box>
  );
}

function ChannelPagination({ page, hasNext, onPrevious, onNext }: { page: number; hasNext: boolean; onPrevious: () => void; onNext: () => void }) {
  return <Stack direction="row" spacing={2} sx={{ alignItems: "center", justifyContent: "center", my: 2 }}>
    <Button variant="outlined" disabled={page <= 1} onClick={onPrevious}>前の50件</Button>
    <Typography variant="body2">{page}ページ</Typography>
    <Button variant="outlined" disabled={!hasNext} onClick={onNext}>次の50件</Button>
  </Stack>;
}

function formatPublishedAt(timestamp: number) {
  return `${new Intl.DateTimeFormat("ja-JP", { year: "numeric", month: "long", day: "numeric" }).format(new Date(timestamp * 1000))} 公開`;
}

function VideoCard({ video, opening, onPlay }: { video: Video; opening: string | null; onPlay: () => void }) {
  const open = () => { if (opening === null) onPlay(); };
  const handleKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key === "Enter" || event.key === " ") { event.preventDefault(); open(); }
  };
  return (
    <Box component="article" role="button" tabIndex={opening === null ? 0 : -1} aria-label={`${video.title}を再生`} onClick={open} onKeyDown={handleKeyDown} sx={{ display: "flex", gap: { xs: 1.5, sm: 2 }, py: 1.5, borderBottom: 1, borderColor: "divider", alignItems: "flex-start", cursor: opening === null ? "pointer" : "default", borderRadius: 1, outline: "none", "&:hover": { bgcolor: "action.hover" }, "&:focus-visible": { boxShadow: "0 0 0 2px", color: "primary.main" } }}>
      <Box sx={{ position: "relative", flex: "0 0 auto", width: { xs: 160, sm: 246 }, aspectRatio: "16 / 9", overflow: "hidden", borderRadius: 1, bgcolor: "grey.200" }}>
        <Box component="img" src={`https://i.ytimg.com/vi/${video.id}/hqdefault.jpg`} alt="" sx={{ width: "100%", height: "100%", display: "block", objectFit: "cover" }} />
        <IconButton aria-label={`${video.title}を再生`} disabled={opening !== null} onClick={event => { event.stopPropagation(); open(); }} sx={{ position: "absolute", right: 8, bottom: 8, width: 36, height: 36, color: "common.white", bgcolor: "rgba(0, 0, 0, 0.72)", "&:hover": { bgcolor: "rgba(0, 0, 0, 0.9)" } }}>
          <PlayArrowRounded fontSize="small" />
        </IconButton>
      </Box>
      <Box sx={{ minWidth: 0, pt: 0.25 }}>
        <Typography variant="subtitle1" component="h3" sx={{ fontWeight: 600, lineHeight: 1.35, overflowWrap: "anywhere", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{video.title}</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75, fontSize: 13 }}>{video.channel}{video.published_at ? ` ・ ${formatPublishedAt(video.published_at)}` : ""}</Typography>
        {video.description && <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, fontSize: 13, lineHeight: 1.45, display: { xs: "none", sm: "-webkit-box" }, WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden", whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{video.description}</Typography>}
      </Box>
    </Box>
  );
}
export default App;
