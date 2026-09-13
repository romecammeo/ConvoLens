import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createApp } from "../src/app.js";
import { AnalysisError } from "../src/calibration.js";

const sample = {
  userSpeakerId: "speaker_2",
  participants: ["speaker_1", "speaker_2"],
  transcript: [
    { id: "segment_1", speakerId: "speaker_1", text: "What exactly are you proposing?" },
    { id: "segment_2", speakerId: "speaker_2", text: "I guess maybe we could look at doing it another way." }
  ]
};
test("calibration HTTP contract", async t => {
  const server = createApp().listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve())));
  const address = server.address();
  assert(address && typeof address !== "string");
  const url = `http://127.0.0.1:${address.port}/api/calibration`;
  const post = (body: unknown) => fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  await t.test("sample produces deterministic observations for speaker_2", async () => {
    const response = await post(sample);
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.mode, "deterministic-stub");
    assert.equal(result.userSpeakerId, "speaker_2");
    assert.equal(result.segmentCount, 2);
    assert.deepEqual(result.observations, [{ segmentId: "segment_2", wordCount: 11, tentativePhrases: ["i guess", "maybe", "could"] }]);
    assert.deepEqual(await (await post(sample)).json(), result);
  });
  await t.test("user clarification is returned with explicit provenance", async () => {
    const calibration = { segmentId: "segment_2", userMeaning: "I want to suggest another approach." };
    const r = await post({ ...sample, calibration });
    assert.equal(r.status, 200);
    assert.deepEqual((await r.json()).clarification, { source: "user-provided", ...calibration });
  });
  for (const [name, body] of [
    ["clarification missing segment", { ...sample, calibration: { segmentId: "missing", userMeaning: "Meaning" } }],
    ["clarification other speaker", { ...sample, calibration: { segmentId: "segment_1", userMeaning: "Meaning" } }],
    ["clarification blank meaning", { ...sample, calibration: { segmentId: "segment_2", userMeaning: " " } }],
    ["missing fields", {}],
    ["unknown user", { ...sample, userSpeakerId: "missing" }],
    ["duplicate participants", { ...sample, participants: ["speaker_1", "speaker_2", "speaker_2"] }],
    ["empty transcript", { ...sample, transcript: [] }],
    ["duplicate segment IDs", { ...sample, transcript: [sample.transcript[1], sample.transcript[1]] }],
    ["unknown speaker", { ...sample, transcript: [{ ...sample.transcript[1], speakerId: "missing" }] }],
    ["blank text", { ...sample, transcript: [{ ...sample.transcript[1], text: "  " }] }],
    ["no user segment", { ...sample, transcript: [sample.transcript[0]] }],
    ["too many segments", { ...sample, transcript: Array(501).fill(sample.transcript[1]) }],
    ["extra fields", { ...sample, apiKey: "must-not-be-accepted" }]
  ]) {
    await t.test(String(name), async () => {
      const response = await post(body);
      assert.equal(response.status, 400);
      assert.equal((await response.json()).error.code, "INVALID_INPUT");
    });
  }
  await t.test("malformed JSON", async () => {
    const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{" });
    assert.equal(r.status, 400);
    assert.equal((await r.json()).error.code, "INVALID_JSON");
  });
  await t.test("oversized body", async () => {
    assert.equal((await post({ text: "a".repeat(140000) })).status, 413);
  });
  await t.test("content type and unknown route", async () => {
    assert.equal((await fetch(url, { method: "POST", body: "hello" })).status, 415);
    assert.equal((await fetch(url)).status, 404);
  });
  await t.test("local preflight and foreign-origin restriction", async () => {
    const r = await fetch(url, { method: "OPTIONS", headers: { Origin: "http://localhost:5173", "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type" } });
    assert.equal(r.status, 204);
    assert.equal(r.headers.get("access-control-allow-origin"), "http://localhost:5173");
    assert.equal(r.headers.get("access-control-allow-methods"), "POST");
    const foreign = await fetch(url, { headers: { Origin: "https://example.com" } });
    assert.notEqual(foreign.headers.get("access-control-allow-origin"), "https://example.com");
  });
});
test("health endpoint reports that the server is running", async t => {
  const server = createApp().listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
  const address = server.address();
  assert(address && typeof address !== "string");
  const response = await fetch(`http://127.0.0.1:${address.port}/health`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: "ok" });
});
test("analyzer failure returns a safe error", async t => {
  const server = createApp(async () => { throw new Error("secret provider error"); }).listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve())));
  const address = server.address();
  assert(address && typeof address !== "string");
  const r = await fetch(`http://127.0.0.1:${address.port}/api/calibration`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(sample) });
  assert.equal(r.status, 500);
  assert.deepEqual(await r.json(), { error: { code: "ANALYSIS_FAILED", message: "Analysis could not be completed." } });
});

test("provider failures keep their safe status and code", async t => {
  for (const [code, status, message] of [
    ["PROVIDER_RATE_LIMIT", 429, "Groq rate limit reached. Try again shortly."],
    ["INVALID_PROVIDER_OUTPUT", 502, "Groq returned invalid JSON."],
    ["PROVIDER_UNAVAILABLE", 503, "Groq is currently unavailable."],
    ["PROVIDER_TIMEOUT", 504, "Groq did not respond in time."]
  ] as const) {
    await t.test(code, async () => {
      const server = createApp(async () => {
        throw new AnalysisError(code, status, message);
      }).listen(0, "127.0.0.1");
      await once(server, "listening");
      const address = server.address();
      assert(address && typeof address !== "string");
      try {
        const response = await fetch(`http://127.0.0.1:${address.port}/api/calibration`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(sample)
        });
        assert.equal(response.status, status);
        assert.deepEqual(await response.json(), { error: { code, message } });
      } finally {
        await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      }
    });
  }
});
