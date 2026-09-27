import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";

test("video sharing snapshots trusted playback time and resets on video change", async () => {
  const slots: any[] = [];
  let cursor = 0;
  let effects: (() => void)[] = [];
  const exports: any = {};
  const browserCalls: any[] = [];
  const listeners = new Set<(event: any) => void>();
  const frameWindow = {};
  const cleanups: any[] = [];
  const jsx = (type: unknown, props: unknown) => ({ type, props });
  const source = readFileSync("src/App.tsx", "utf8") + "\nexport { PlayerView };";
  runInNewContext(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, {
    exports, URL, URLSearchParams, window: {
      location: { search: "" },
      addEventListener(_: string, listener: any) { listeners.add(listener); },
      removeEventListener(_: string, listener: any) { listeners.delete(listener); },
    },
    require(name: string) {
      if (name === "react") return {
        useRef(initial: unknown) { const index = cursor++; return slots[index] ??= { current: initial }; },
        useState(initial: unknown) {
          const index = cursor++;
          if (!(index in slots)) slots[index] = initial;
          return [slots[index], (value: unknown) => { slots[index] = value; }];
        },
        useEffect(callback: () => void, deps: unknown[]) {
          const index = cursor++;
          if (!slots[index] || deps.some((dep, i) => dep !== slots[index][i])) effects.push(() => {
            cleanups[index]?.();
            cleanups[index] = callback();
          });
          slots[index] = deps;
        },
      };
      if (name === "react/jsx-runtime") return { jsx, jsxs: jsx };
      if (name === "@tauri-apps/api/core") return { invoke: async (command: string, args: unknown) => {
        if (command === "open_video_in_browser") browserCalls.push(args);
        return "http://127.0.0.1/player";
      } };
      return new Proxy({}, { get: (_, key) => key });
    },
  });
  function render(id = "abcdefghijk") {
    cursor = 0; effects = [];
    const tree = exports.PlayerView({ video: { id, title: "動画", channel: "チャンネル" }, onChannel() {} });
    effects.forEach(effect => effect());
    return tree;
  }
  function find(node: any, type: string, label?: string): any {
    if (!node || typeof node !== "object") return;
    if (node.type === type && (!label || node.props.children === label)) return node;
    return [node.props?.children].flat(Infinity).map(child => find(child, type, label)).find(Boolean);
  }
  let tree = render();
  await Promise.resolve();
  tree = render();
  find(tree, "iframe").props.ref.current = { contentWindow: frameWindow };
  const message = (currentTime: unknown, overrides = {}) => {
    listeners.forEach(listener => listener({ source: frameWindow, origin: "http://127.0.0.1", data: { type: "mytube-player", videoId: "abcdefghijk", currentTime }, ...overrides }));
  };
  assert.equal(find(tree, "Dialog").props.open, false);
  find(tree, "Button", "YouTubeで開く").props.onClick();
  assert.equal(browserCalls.at(-1).startSeconds, null);
  find(tree, "Button", "QRコードで共有").props.onClick();
  tree = render();
  assert.equal(find(tree, "Dialog").props.open, true);
  assert.equal(find(tree, "QRCodeSVG").props.value, "https://www.youtube.com/watch?v=abcdefghijk");
  assert.equal(find(tree, "QRCodeSVG").props.marginSize, 4);
  message(123.75);
  find(tree, "Button", "YouTubeで開く").props.onClick();
  assert.equal(browserCalls.at(-1).id, "abcdefghijk");
  assert.equal(browserCalls.at(-1).startSeconds, 123);
  find(tree, "Button", "QRコードで共有").props.onClick();
  tree = render();
  assert.equal(find(tree, "QRCodeSVG").props.value, "https://www.youtube.com/watch?v=abcdefghijk&t=123s");
  message(200);
  assert.equal(find(render(), "QRCodeSVG").props.value, "https://www.youtube.com/watch?v=abcdefghijk&t=123s", "共有中は位置を固定する");
  message(999, { origin: "https://evil.example" });
  message(999, { source: {} });
  message(999, { data: { type: "mytube-player", videoId: "other_video", currentTime: 999 } });
  find(tree, "Button", "YouTubeで開く").props.onClick();
  assert.equal(browserCalls.at(-1).startSeconds, 200, "QR共有の固定位置ではなく最新の検証済み位置を使う");
  find(tree, "Button", "QRコードで共有").props.onClick();
  assert.equal(find(render(), "QRCodeSVG").props.value, "https://www.youtube.com/watch?v=abcdefghijk&t=200s");
  for (const invalid of [NaN, Infinity, -1, "123", null, Number.MAX_VALUE]) {
    message(invalid);
    find(tree, "Button", "YouTubeで開く").props.onClick();
    assert.equal(browserCalls.at(-1).startSeconds, null);
    find(tree, "Button", "QRコードで共有").props.onClick();
    assert.equal(find(render(), "QRCodeSVG").props.value, "https://www.youtube.com/watch?v=abcdefghijk");
  }
  message(0);
  find(tree, "Button", "YouTubeで開く").props.onClick();
  assert.equal(browserCalls.at(-1).startSeconds, 0);
  find(tree, "Button", "QRコードで共有").props.onClick();
  assert.equal(find(render(), "QRCodeSVG").props.value, "https://www.youtube.com/watch?v=abcdefghijk&t=0s");
  find(tree, "Button", "閉じる").props.onClick();
  assert.equal(find(render(), "Dialog").props.open, false);
  find(tree, "Button", "QRコードで共有").props.onClick();
  find(render(), "Dialog").props.onClose();
  assert.equal(find(render(), "Dialog").props.open, false);
  find(tree, "Button", "QRコードで共有").props.onClick();
  render("123456789_-");
  tree = render("123456789_-");
  find(tree, "Button", "YouTubeで開く").props.onClick();
  assert.equal(browserCalls.at(-1).id, "123456789_-");
  assert.equal(browserCalls.at(-1).startSeconds, null);
  assert.equal(find(tree, "Dialog").props.open, false);
  assert.equal(find(tree, "QRCodeSVG").props.value, "https://www.youtube.com/watch?v=123456789_-");
});
