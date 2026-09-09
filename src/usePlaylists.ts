import { useEffect, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import type { Video } from "./search";

export interface Playlist { id: string; title: string }
export interface PlaylistPage { videos: Video[]; page: number; has_next: boolean }
export function usePlaylists() {
  const [items, setItems] = useState<Playlist[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<Playlist | null>(null);
  const [result, setResult] = useState<PlaylistPage | null>(null);
  const [videosBusy, setVideosBusy] = useState(false);
  const [videosError, setVideosError] = useState("");
  const requestedPage = useRef(1);
  const active = useRef(true);
  const listing = useRef<Promise<void> | null>(null);
  const request = useRef(0);
  const cache = useRef(new Map<string, PlaylistPage>());
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);

  function refresh(force = false): Promise<void> {
    if (listing.current) return listing.current;
    setBusy(true); setError("");
    if (force) cache.current.clear();
    listing.current = (async () => {
      try {
        if (!isTauri()) throw "再生リストはデスクトップアプリで利用できます。";
        const items = await invoke<Playlist[]>("fetch_playlists", { force });
        if (active.current) setItems(items);
      } catch (error) {
        if (active.current) setError(typeof error === "string" ? error : "再生リストを取得できませんでした。");
      } finally { listing.current = null; if (active.current) setBusy(false); }
    })();
    return listing.current;
  }
  async function select(item: Playlist, page = 1) {
    const id = ++request.current;
    requestedPage.current = page;
    setSelected(item); setVideosError(""); setResult(null);
    const key = `${item.id}:${page}`;
    const cached = cache.current.get(key);
    if (cached) { setResult(cached); setVideosBusy(false); return; }
    setVideosBusy(true);
    try {
      const result = await invoke<PlaylistPage>("fetch_playlist_videos", { playlistId: item.id, page });
      if (!active.current || request.current !== id) return;
      cache.current.set(key, result); setResult(result);
    } catch (error) {
      if (active.current && request.current === id) setVideosError(typeof error === "string" ? error : "動画を取得できませんでした。");
    } finally { if (active.current && request.current === id) setVideosBusy(false); }
  }
  function clear() { request.current += 1; setSelected(null); setResult(null); setVideosBusy(false); setVideosError(""); }
  return { items, busy, error, selected, result, videosBusy, videosError, refresh, select, clear, retry: () => selected && select(selected, requestedPage.current) };
}
