export interface Video {
  id: string;
  title: string;
  channel: string;
  description: string;
  published_at?: number;
  channel_icon?: string;
  channel_id?: string;
}
export interface SearchResult { videos: Video[]; scanned: number; elapsed_ms: number; page: number; has_next: boolean }
export interface SearchStatus {
  id: number;
  phase: string;
  finished: boolean;
  result: SearchResult | null;
  error: string | null;
}
export interface SubscriptionsResult { videos: Video[]; channel_icons: Record<string, string>; channel_ids: Record<string, string>; elapsed_ms: number }
export interface ChannelVideosResult { videos: Video[]; page: number; has_next: boolean; elapsed_ms: number }
export interface SubscriptionsStatus {
  id: number;
  phase: string;
  finished: boolean;
  result: SubscriptionsResult | null;
  error: string | null;
}
