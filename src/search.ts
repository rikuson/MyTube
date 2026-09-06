export interface Video {
  id: string;
  title: string;
  channel: string;
  description: string;
}
export interface SearchResult { videos: Video[]; scanned: number; elapsed_ms: number; page: number; has_next: boolean }
export interface SearchStatus {
  id: number;
  phase: string;
  finished: boolean;
  result: SearchResult | null;
  error: string | null;
}
export interface SubscriptionsResult { videos: Video[]; elapsed_ms: number }
export interface SubscriptionsStatus {
  id: number;
  phase: string;
  finished: boolean;
  result: SubscriptionsResult | null;
  error: string | null;
}
