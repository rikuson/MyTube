export interface Video {
  id: string;
  title: string;
  channel: string;
  match_score: number;
  recommendation_score: number;
  reason: string;
  evidence: string;
}
export interface SearchResult { videos: Video[]; scanned: number; evaluated: number }
export interface SearchStatus {
  id: number;
  phase: string;
  finished: boolean;
  result: SearchResult | null;
  error: string | null;
}
export function rankedVideos(videos: Video[], matchWeight: number) {
  const weight = Math.max(0, Math.min(100, matchWeight));
  return videos.map(video => ({
    ...video,
    score: (video.match_score * weight + video.recommendation_score * (100 - weight)) / 100,
  })).sort((a, b) => b.score - a.score || b.match_score - a.match_score || a.id.localeCompare(b.id));
}
