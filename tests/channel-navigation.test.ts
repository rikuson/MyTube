import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";

test("unsubscribed channels survive subscription sync and retain their ID for paging and retry", async () => {
  const slots: any[] = [];
  let cursor = 0;
  let effects: (() => unknown)[] = [];
  let dirty = true;
  let tree: any;
  const calls: any[] = [];
  let fail = false;
  let finishSync: (value: unknown) => void = () => {};
  const cached = new Promise(resolve => { finishSync = resolve; });
  const react = {
    useState(initial: unknown) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = initial;
      return [slots[index], (value: any) => {
        const next = typeof value === "function" ? value(slots[index]) : value;
        if (!Object.is(next, slots[index])) { slots[index] = next; dirty = true; }
      }];
    },
    useRef(initial: unknown) {
      const index = cursor++;
      return slots[index] ??= { current: initial };
    },
    useEffect(callback: () => unknown, deps: unknown[]) {
      const index = cursor++;
      if (!slots[index] || deps.some((dep, i) => !Object.is(dep, slots[index][i]))) {
        slots[index] = deps;
        effects.push(callback);
      }
    },
  };
  const jsx = (type: any, props: any) => ({ type, props });
  const exports: any = {};
  const source = ts.transpileModule(readFileSync("src/App.tsx", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  runInNewContext(source, {
    exports, URLSearchParams, document: {},
    window: {
      location: { search: "?channel=UCaaaaaaaaaaaaaaaaaaaaaa&channelName=未登録", pathname: "/" },
      history: { replaceState() {} }, addEventListener() {}, removeEventListener() {}, scrollTo() {},
    },
    require(name: string) {
      if (name === "react") return react;
      if (name === "react/jsx-runtime") return { jsx, jsxs: jsx };
      if (name === "./usePlaylists") return { usePlaylists: () => ({ items: [], clear() {} }) };
      if (name === "./viewHistory") return { enterPlayer: (video: unknown) => video, leavePlayer: () => null };
      if (name === "@tauri-apps/api/core") return {
        isTauri: () => true,
        async invoke(command: string, args: any) {
          if (command === "cached_subscriptions") return cached;
          if (command === "hydrate_video") throw "詳細取得なし";
          if (command === "fetch_channel_videos") {
            calls.push(args);
            if (fail) throw "取得失敗";
            return { videos: [{ id: "abcdefghijk", title: "チャンネル動画", channel: "別の未登録", channel_id: "UCcccccccccccccccccccccc" }], page: args.page, has_next: true };
          }
        },
      };
      return new Proxy({}, { get: (_, key) => key });
    },
  });
  async function settle() {
    for (let i = 0; i < 20; i++) {
      if (dirty) {
        dirty = false; cursor = 0; effects = [];
        tree = exports.default();
        effects.forEach(effect => effect());
      }
      await Promise.resolve();
    }
    assert.equal(dirty, false);
  }
  function find(predicate: (node: any) => boolean, node = tree): any {
    if (!node || typeof node !== "object") return;
    if (predicate(node)) return node;
    for (const child of [node.props?.children].flat(Infinity)) {
      if (!child || typeof child !== "object") continue;
      const match = find(predicate, child);
      if (match) return match;
    }
  }
  await settle();
  finishSync({ videos: [{ id: "home", title: "ホーム動画" }], channel_ids: { 登録済み: "UCbbbbbbbbbbbbbbbbbbbbbb" }, channel_icons: {} });
  await settle();
  const section = () => find(node => node.props?.["aria-label"] === "チャンネルの動画");
  assert.ok(section(), "同期完了後も未登録チャンネルを表示する");
  assert.equal(find(node => node.props?.video?.id === "home"), undefined);
  find(node => node.type?.name === "VideoPagination").props.onChange(2);
  await settle();
  assert.equal(calls.at(-1).channelId, "UCaaaaaaaaaaaaaaaaaaaaaa");
  assert.equal(find(node => node.type?.name === "VideoPagination").props.page, 2);
  fail = true;
  find(node => node.type?.name === "VideoPagination").props.onChange(3);
  await settle();
  assert.ok(section());
  fail = false;
  find(node => node.type === "Alert" && node.props.children === "取得失敗").props.action.props.onClick();
  await settle();
  assert.equal(calls.at(-1).channelId, "UCaaaaaaaaaaaaaaaaaaaaaa");
  assert.equal(calls.at(-1).page, 3);
  find(node => node.type?.name === "VideoCard").props.onPlay();
  await settle();
  find(node => node.type?.name === "PlayerView").props.onChannel();
  await settle();
  assert.ok(section(), "再生画面から開いた未登録チャンネルも保持する");
  find(node => node.type?.name === "VideoPagination").props.onChange(2);
  await settle();
  assert.equal(calls.at(-1).channelId, "UCcccccccccccccccccccccc");
  assert.equal(calls.at(-1).page, 2);
});
