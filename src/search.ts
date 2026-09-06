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
