import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

function setup() {
  let config: any;
  let destroyed = false;
  let url = "https://www.youtube.com/watch?v=abcdefghijk";
  const messages: any[] = [];
  let tick = () => {};
  const status = { textContent: "" };
  const context = {
    window: {} as any,
    document: { getElementById: () => status },
    parent: { postMessage(message: unknown) { messages.push(message); } },
    URL, setTimeout: () => 1, clearTimeout() {}, setInterval(callback: () => void) { tick = callback; return 1; }, clearInterval() {},
    YT: { Player: function (_: unknown, options: any) {
      config = options;
      return { getVideoUrl: () => url, getCurrentTime: () => 123.75, destroy() { destroyed = true; } };
    } },
  };
  const html = readFileSync("src-tauri/src/player_embed.html", "utf8");
  const script = html.split("<script>")[1].split("</script>")[0]
    .replace("__VIDEO_ID__", '"abcdefghijk"').replace("__ORIGIN__", '"http://127.0.0.1:1234"');
  runInNewContext(script, context);
  context.window.onYouTubeIframeAPIReady();
  return { config, status, messages, tick: () => tick(), destroyed: () => destroyed, selectOther() { url = "https://www.youtube.com/watch?v=other_video"; } };
}

test("HTTP player uses its real origin and keeps the selected video after ending", () => {
  const s = setup();
  assert.equal(s.config.playerVars.origin, "http://127.0.0.1:1234");
  assert.equal(s.config.playerVars.autoplay, 0);
  assert.equal(s.config.playerVars.fs, 1);
  s.config.events.onReady();
  s.tick();
  assert.equal(s.messages.at(-1).currentTime, 123.75);
  assert.equal(s.messages.at(-1).videoId, "abcdefghijk");
  s.config.events.onStateChange({ data: 0 });
  assert.equal(s.destroyed(), false);
});

test("HTTP player stops other selections and displays embedding failures", () => {
  const s = setup();
  s.selectOther();
  s.config.events.onStateChange({ data: 1 });
  assert.equal(s.destroyed(), true);
  assert.equal(s.messages.at(-1).currentTime, null);
  const error = setup();
  error.config.events.onError({ data: 153 });
  assert.match(error.status.textContent, /153/);
  assert.equal(error.destroyed(), true);
});
