import { test } from "node:test";
import assert from "node:assert/strict";
import { AnalysisError } from "../src/calibration.js";
import { createGroqAnalyzer, createGroqReviewCandidateFinder } from "../src/groq.js";

const conversation = {
  userSpeakerId: "speaker_2",
  participants: ["speaker_1", "speaker_2"],
  transcript: [
    { id: "segment_1", speakerId: "speaker_1", text: "What exactly are you proposing?" },
    { id: "segment_2", speakerId: "speaker_2", text: "I guess maybe we could look at doing it another way." }
  ],
  calibration: {
    segmentId: "segment_2",
    userMeaning: "I want to suggest another approach."
  }
};

const validOutput = JSON.stringify({
  analysis: [{
    segmentId: "segment_2",
    evidence: "I guess maybe we could look at doing it another way.",
    likelyConveyedMeaning: "The speaker tentatively suggested considering an alternative.",
    interpretation: "The hedging makes the proposal sound less definite.",
    clarificationQuestion: "I interpreted this as a tentative suggestion to consider an alternative. Is that what you intended, or was there a more specific proposal?",
    clarificationComparison: "The intended meaning is more direct than the wording conveyed.",
    refinedFormulation: "I suggest that we consider a different approach."
  }]
});

test("Groq adapter builds grounded input and returns validated structured analysis", async () => {
  let observedRequest: { model: string; systemPrompt: string; userPrompt: string } | undefined;
  const analyzer = createGroqAnalyzer({ apiKey: "test-key" }, async request => {
    observedRequest = request;
    return validOutput;
  });

  const result = await analyzer(conversation);
  assert.equal(result.mode, "groq");
  assert.equal(result.analysis?.[0]?.segmentId, "segment_2");
  assert.equal(result.analysis?.[0]?.refinedFormulation, "I suggest that we consider a different approach.");
  assert.deepEqual(result.clarification, { source: "user-provided", ...conversation.calibration });
  assert.equal(observedRequest?.model, "openai/gpt-oss-20b");
  assert.match(observedRequest?.systemPrompt ?? "", /never claim knowledge of private mental states/i);
  assert.match(observedRequest?.systemPrompt ?? "", /at that point in this conversation/i);
  assert.match(observedRequest?.systemPrompt ?? "", /do not merely paraphrase/i);
  assert.deepEqual(JSON.parse(observedRequest?.userPrompt ?? "{}"), {
    userSpeakerId: "speaker_2",
    targetSegmentIds: ["segment_2"],
    selectedUtterances: [conversation.transcript[1]],
    surroundingContext: conversation.transcript,
    transcript: conversation.transcript,
    userIntendedMeaning: conversation.calibration.userMeaning
  });
  assert.doesNotMatch(observedRequest?.userPrompt ?? "", /test-key/);
});

test("Groq adapter accepts an exact evidence substring wrapped in quotation marks", async () => {
  const quoted = validOutput.replace(
    "I guess maybe we could look at doing it another way.",
    "“I guess maybe we could”"
  );
  const analyzer = createGroqAnalyzer({ apiKey: "test-key" }, async () => quoted);
  assert.equal((await analyzer(conversation)).mode, "groq");
});

test("Groq adapter analyzes one explicitly selected utterance before calibration", async () => {
  let observedPrompt: Record<string, unknown> | undefined;
  const analyzer = createGroqAnalyzer({ apiKey: "test-key" }, async request => {
    observedPrompt = JSON.parse(request.userPrompt) as Record<string, unknown>;
    return JSON.stringify({
      analysis: [{
        segmentId: "segment_2",
        evidence: "maybe we could look at doing it another way",
        likelyConveyedMeaning: "The speaker tentatively suggested an alternative.",
        interpretation: "The wording makes the proposal sound tentative.",
        clarificationQuestion: "I interpreted this as a tentative suggestion. Is that what you intended, or was there a more specific proposal?",
        clarificationComparison: null,
        refinedFormulation: "I suggest that we consider a different approach."
      }]
    });
  });

  const result = await analyzer({
    userSpeakerId: conversation.userSpeakerId,
    participants: conversation.participants,
    transcript: conversation.transcript,
    analysisTargetSegmentId: "segment_2"
  });

  assert.deepEqual(observedPrompt?.targetSegmentIds, ["segment_2"]);
  assert.equal(observedPrompt?.userIntendedMeaning, null);
  assert.equal(result.analysis?.length, 1);
  assert.equal(result.clarification, undefined);
});

test("Groq review finder selects validated focus-speaker turns", async () => {
  let observedRequest: { schemaName: string; systemPrompt: string; userPrompt: string } | undefined;
  const findCandidates = createGroqReviewCandidateFinder({ apiKey: "test-key" }, async request => {
    observedRequest = request;
    return JSON.stringify({
      candidates: [{
        segmentId: "segment_2",
        reason: "Tentative wording may leave the proposed alternative unclear."
      }]
    });
  });

  const result = await findCandidates(conversation);
  assert.equal(result.mode, "groq");
  assert.equal(result.candidates[0]?.segmentId, "segment_2");
  assert.equal(observedRequest?.schemaName, "convolens_review_candidates");
  assert.match(observedRequest?.systemPrompt ?? "", /between 2 and 4/i);
  assert.deepEqual(JSON.parse(observedRequest?.userPrompt ?? "{}"), {
    userSpeakerId: conversation.userSpeakerId,
    transcript: conversation.transcript
  });
});

for (const [name, output] of [
  ["another speaker's turn", JSON.stringify({ candidates: [{ segmentId: "segment_1", reason: "Reason" }] })],
  ["duplicate turns", JSON.stringify({ candidates: [
    { segmentId: "segment_2", reason: "Reason one" },
    { segmentId: "segment_2", reason: "Reason two" }
  ] })]
]) {
  test(`Groq review finder rejects ${name}`, async () => {
    const findCandidates = createGroqReviewCandidateFinder({ apiKey: "test-key" }, async () => output);
    await assert.rejects(
      () => findCandidates(conversation),
      (error: unknown) => error instanceof AnalysisError && error.code === "INVALID_PROVIDER_OUTPUT"
    );
  });
}

for (const [name, output] of [
  ["invalid JSON", "not JSON"],
  ["wrong segment", validOutput.replaceAll("segment_2", "segment_1")],
  ["evidence not quoted", validOutput.replace("I guess maybe we could look at doing it another way.", "A paraphrase")]
]) {
  test(`Groq adapter rejects ${name}`, async () => {
    const analyzer = createGroqAnalyzer({ apiKey: "test-key" }, async () => output);
    await assert.rejects(
      () => analyzer(conversation),
      (error: unknown) => error instanceof AnalysisError && error.code === "INVALID_PROVIDER_OUTPUT"
    );
  });
}

test("Groq adapter maps unknown provider failures", async () => {
  const analyzer = createGroqAnalyzer({ apiKey: "test-key" }, async () => {
    throw new Error("provider internals");
  });
  await assert.rejects(
    () => analyzer(conversation),
    (error: unknown) => error instanceof AnalysisError &&
      error.code === "PROVIDER_UNAVAILABLE" &&
      !error.message.includes("provider internals")
  );
});
