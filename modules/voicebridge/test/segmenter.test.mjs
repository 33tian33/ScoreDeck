import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fallbackSegments, normalizeModelOutput, segmentConversation } from "../lib/segmenter.mjs";

const demo = JSON.parse(await readFile(new URL("../data/demo-channels.json", import.meta.url), "utf8"));
const alpha = demo.channels[0].utterances;
const bravo = demo.channels[1].utterances;

test("both channels fall back independently and cover every utterance", () => {
  for (const utterances of [alpha, bravo]) {
    const segments = fallbackSegments(utterances, { final: true });
    assert.ok(segments.length >= 1);
    assert.deepEqual(segments.flatMap((segment) => segment.utteranceIds), utterances.map((item) => item.id));
    assert.ok(segments.every((segment) => segment.status === "committed"));
  }
});

test("model boundaries are mapped to authoritative timestamps", () => {
  const raw = {
    segments: [
      {
        segment_id: "seg_a",
        start_utterance_id: "a001",
        end_utterance_id: "a003",
        title: "绕后计划",
        summary: "决定从B点绕后。",
        category: "strategy",
        importance: 76,
        tags: ["绕后"]
      },
      {
        segment_id: "seg_b",
        start_utterance_id: "a004",
        end_utterance_id: "a013",
        title: "后续交战",
        summary: "队伍完成交战并准备下一波。",
        category: "team_fight",
        importance: 84,
        tags: ["团战"]
      }
    ]
  };
  const segments = normalizeModelOutput(raw, alpha, { final: true });
  assert.equal(segments[0].startMs, 500);
  assert.equal(segments[0].endMs, 4500);
  assert.equal(segments[1].startMs, 6300);
  assert.equal(segments[1].endMs, 24200);
});

test("invalid or incomplete model coverage is rejected", () => {
  const raw = {
    segments: [
      {
        start_utterance_id: "a002",
        end_utterance_id: "a003",
        title: "错误边界"
      }
    ]
  };
  assert.throws(() => normalizeModelOutput(raw, alpha), /边界不连续/);
});

test("missing API key yields usable and isolated channel results", async () => {
  const [alphaResult, bravoResult] = await Promise.all([
    segmentConversation(alpha, { final: true, apiKey: "" }),
    segmentConversation(bravo, { final: true, apiKey: "" })
  ]);
  assert.equal(alphaResult.source, "fallback");
  assert.equal(bravoResult.source, "fallback");
  assert.ok(alphaResult.segments.every((segment) => segment.utteranceIds.every((id) => id.startsWith("a"))));
  assert.ok(bravoResult.segments.every((segment) => segment.utteranceIds.every((id) => id.startsWith("b"))));
});
