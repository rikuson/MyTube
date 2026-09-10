import { test } from "node:test";
import assert from "node:assert/strict";
import { enterPlayer, leavePlayer } from "../src/viewHistory.ts";

test("leaving a player replaces it so Back returns to the latest list", () => {
  const entries: unknown[] = [null];
  let index = 0;
  const history = {
    get state() { return entries[index]; },
    pushState(state: unknown) { entries.splice(++index, entries.length, state); },
    replaceState(state: unknown) { entries[index] = state; },
  };
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { history, location: { href: "tauri://localhost" } },
  });

  enterPlayer({ id: "abcdefghijk", title: "A", channel: "C", description: "" });
  leavePlayer();
  enterPlayer({ id: "lmnopqrstuv", title: "B", channel: "C", description: "" });
  index -= 1;

  assert.equal(history.state, null);
});
