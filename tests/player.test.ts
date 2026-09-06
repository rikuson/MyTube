import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
function setup() {
  const nodes = Object.fromEntries(["stage", "status", "retry", "back", "video-title", "channel", "avatar", "subscribe"].map(id => [id, { hidden: false, textContent: "", innerHTML: "", replaceChildren() {} }]));
  let options: any;
  let destroyed = false;
  let url = "https://www.youtube.com/watch?v=abcdefghijk";
  const fakePlayer = { destroy() { destroyed = true; }, getVideoUrl() { return url; } };
  const context: any = {
    document: { getElementById: (id: string) => nodes[id], createElement: () => ({ remove() {} }), head: { appendChild() {} }, title: "" },
    window: { location: { replace(value: string) { context.returnedTo = value; } } }, URL, setTimeout: () => 1, clearTimeout() {}, setInterval: () => 1, clearInterval() {},
    YT: { Player: function (_: unknown, config: unknown) { options = config; return fakePlayer; } },
  };
  context.window.YT = context.YT;
  const html = readFileSync("src-tauri/src/player.html", "utf8");
  const script = html.split("<script>")[1].split("</script>")[0].replace("__VIDEO_ID__", '"abcdefghijk"').replace("__ORIGIN__", '"https://com.codextube.desktop"').replace("__RETURN_URL__", '"tauri://localhost"').replace("__TITLE__", '"動画タイトル"').replace("__CHANNEL__", '"チャンネル"');
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
test("player displays the selected channel and subscribe button", () => {
  const s = setup();
  assert.equal(s.nodes["video-title"].textContent, "動画タイトル");
  assert.equal(s.nodes.channel.textContent, "チャンネル");
  s.nodes.subscribe.onclick();
  assert.match(s.nodes.status.textContent, /YouTube連携/);
});
