import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
function setup(description = "動画の概要") {
  const nodes = Object.fromEntries(["stage", "status", "retry", "back", "video-title", "video-description", "channel", "avatar", "subscribe", "search-form", "search-input", "search-button"].map(id => [id, { hidden: false, disabled: false, textContent: "", innerHTML: "", value: "", children: [] as any[], classList: { add() {}, remove() {} }, replaceChildren() { this.children = []; }, appendChild(child: any) { this.children.push(child); } }]));
  let options: any;
  let destroyed = false;
  let url = "https://www.youtube.com/watch?v=abcdefghijk";
  const fakePlayer = { destroy() { destroyed = true; }, getVideoUrl() { return url; } };
  const context: any = {
    document: { getElementById: (id: string) => nodes[id], createElement: () => ({ style: {}, remove() {} }), head: { appendChild() {} }, title: "" },
    window: { location: { replace(value: string) { context.returnedTo = value; } } }, URL, setTimeout: () => 1, clearTimeout() {}, setInterval: () => 1, clearInterval() {},
    YT: { Player: function (_: unknown, config: unknown) { options = config; return fakePlayer; } },
  };
  context.window.YT = context.YT;
  const html = readFileSync("src-tauri/src/player.html", "utf8");
  const script = html.split("<script>")[1].split("</script>")[0].replace("__VIDEO_ID__", '"abcdefghijk"').replace("__ORIGIN__", '"https://com.codextube.desktop"').replace("__RETURN_URL__", '"tauri://localhost"').replace("__TITLE__", '"動画タイトル"').replace("__CHANNEL__", '"チャンネル"').replace("__CHANNEL_ICON__", '"https://yt3.googleusercontent.com/avatar"').replace("__DESCRIPTION__", JSON.stringify(description));
  runInNewContext(script, context);
  context.window.onYouTubeIframeAPIReady();
  return { nodes, context, options, destroyed: () => destroyed, setUrl: (value: string) => { url = value; } };
}
test("player does not autoplay and is removed at end", () => {
  const s = setup();
  assert.equal(s.options.playerVars.autoplay, 0);
  s.options.events.onReady();
  s.options.events.onStateChange({ data: 0 });
  assert.ok(s.destroyed());
  assert.equal(s.nodes.stage.hidden, true);
  assert.equal(s.nodes.retry.hidden, false);
});
test("unselected videos and embedding errors stop playback", () => {
  const s = setup();
  s.setUrl("https://www.youtube.com/watch?v=other_video");
  s.options.events.onStateChange({ data: 1 });
  assert.ok(s.destroyed());
  const e = setup();
  e.options.events.onError({ data: 150 });
  assert.match(e.nodes.status.textContent, /埋め込み再生/);
  assert.ok(e.destroyed());
});
test("back returns to the current app window", () => {
  const s = setup();
  s.nodes.back.onclick();
  assert.equal(s.context.returnedTo, "tauri://localhost");
});
test("search returns to the home screen with the query", () => {
  const s = setup();
  s.nodes["search-input"].value = "腕十字";
  s.nodes["search-input"].oninput({ target: s.nodes["search-input"] });
  assert.equal(s.nodes["search-button"].disabled, false);
  s.nodes["search-form"].onsubmit({ preventDefault() {} });
  assert.equal(s.context.returnedTo, "tauri://localhost?q=%E8%85%95%E5%8D%81%E5%AD%97");
});
test("player displays the selected channel and subscribe button", () => {
  const s = setup();
  assert.equal(s.nodes["video-title"].textContent, "動画タイトル");
  assert.equal(s.nodes.channel.textContent, "チャンネル");
  assert.equal(s.nodes["video-description"].textContent, "動画の概要");
  assert.equal(s.nodes.avatar.children[0].src, "https://yt3.googleusercontent.com/avatar");
  s.nodes.subscribe.onclick();
  assert.match(s.nodes.status.textContent, /YouTube連携/);
});
test("player shows a message while loading the description", () => {
  const s = setup("");
  assert.equal(s.nodes["video-description"].textContent, "概要を読み込んでいます…");
  s.context.window.__setVideoDetails("abcdefghijk", "チャンネル", "", "取得した概要");
  assert.equal(s.nodes["video-description"].textContent, "取得した概要");
  assert.equal(s.nodes["video-description"].hidden, false);
});
