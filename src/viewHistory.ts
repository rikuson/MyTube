import type { Video } from "./search";

export function enterPlayer(video: Video) {
  window.history.pushState({ mytubeView: "player", video }, "", window.location.href);
  return video;
}

export function leavePlayer() {
  if (window.history.state?.mytubeView === "player") {
    window.history.replaceState(null, "", window.location.href);
  }
  return null;
}
