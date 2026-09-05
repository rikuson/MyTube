import { test } from "node:test";
import assert from "node:assert/strict";
import { rankedVideos } from "../src/search.ts";
const videos = [
  { id: "a", title: "a", channel: "c", match_score: 90, recommendation_score: 70, reason: "", evidence: "" },
  { id: "b", title: "b", channel: "c", match_score: 70, recommendation_score: 100, reason: "", evidence: "" },
];
test("changing weights reorders accepted results without mutating input", () => {
  assert.equal(rankedVideos(videos, 70)[0].id, "a");
  assert.equal(rankedVideos(videos, 30)[0].id, "b");
  assert.equal(videos[0].id, "a");
  assert.deepEqual(rankedVideos([], 70), []);
});
