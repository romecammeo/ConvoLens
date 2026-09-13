import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createApp } from "../src/app.js";
import {
  TranscriptionError,
  adaptAssemblyAiTranscript,
  adaptMarkdownTranscript,
  type TranscriptionResult
} from "../src/transcription.js";

const providerResponse = {
  id: "transcript_123",
  status: "completed",
  audio_duration: 4.2,
  utterances: [
    { speaker: "B", text: " First speaker turn. ", start: 0, end: 1800 },
    { speaker: "A", text: "Second speaker turn.", start: 1900, end: 4200 },
    { speaker: "B", text: "Final turn.", start: 4300, end: 5000 }
  ]
};

const adapted: TranscriptionResult = {
  transcriptId: "transcript_123",
  audioDurationSeconds: 4.2,
  speakers: [
    { id: "speaker_1", label: "Speaker B" },
    { id: "speaker_2", label: "Speaker A" }
  ],
  participants: ["speaker_1", "speaker_2"],
  transcript: [
    { id: "segment_0001", speakerId: "speaker_1", text: "First speaker turn." },
    { id: "segment_0002", speakerId: "speaker_2", text: "Second speaker turn." },
    { id: "segment_0003", speakerId: "speaker_1", text: "Final turn." }
  ]
};

test("AssemblyAI adapter normalizes provider labels and stable segment IDs", () => {
  assert.deepEqual(adaptAssemblyAiTranscript(providerResponse), adapted);
  assert.deepEqual(adaptAssemblyAiTranscript(providerResponse), adapted);
});

test("Markdown adapter converts speaker-labelled lines into the internal conversation format", () => {
  const markdown = Buffer.from(`# Conversation notes

## Full transcript

- **Alice:** Let us trace the history of the word.
- **Bob:** How would that explain the mechanism?
- **Alice:** It may show what kind of selection the word originally described.
`);
  const result = adaptMarkdownTranscript(markdown);

  assert.match(result.transcriptId, /^markdown_[a-f0-9]{12}$/u);
  assert.equal(adaptMarkdownTranscript(markdown).transcriptId, result.transcriptId);
  assert.deepEqual(result.speakers, [
    { id: "speaker_1", label: "Alice" },
    { id: "speaker_2", label: "Bob" }
  ]);
  assert.deepEqual(result.participants, ["speaker_1", "speaker_2"]);
  assert.deepEqual(result.transcript, [
    { id: "segment_0001", speakerId: "speaker_1", text: "Let us trace the history of the word." },
    { id: "segment_0002", speakerId: "speaker_2", text: "How would that explain the mechanism?" },
    { id: "segment_0003", speakerId: "speaker_1", text: "It may show what kind of selection the word originally described." }
  ]);
});

test("Markdown adapter accepts simple unformatted speaker lines and rejects unlabeled notes", () => {
  const result = adaptMarkdownTranscript(Buffer.from("Speaker A: Hello.\nSpeaker B: Hi."));
  assert.equal(result.transcript.length, 2);
  assert.throws(
    () => adaptMarkdownTranscript(Buffer.from("# Meeting notes\nNo speaker labels here.")),
    (error: unknown) => error instanceof TranscriptionError && error.code === "INVALID_MARKDOWN"
  );
});

for (const [name, response] of [
  ["provider error", { id: "bad", status: "error", error: "private provider detail" }],
  ["unfinished response", { id: "queued", status: "queued" }],
  ["missing utterances", { id: "empty", status: "completed", utterances: [] }],
  ["invalid response", { status: "completed", utterances: [] }]
]) {
  test(`AssemblyAI adapter rejects ${name}`, () => {
    assert.throws(
      () => adaptAssemblyAiTranscript(response),
      (error: unknown) => error instanceof TranscriptionError && !error.message.includes("private provider detail")
    );
  });
}

async function withServer(
  transcribe: Parameters<typeof createApp>[2],
  run: (url: string) => Promise<void>
) {
  const server = createApp(undefined, undefined, transcribe).listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address !== "string");
  try {
    await run(`http://127.0.0.1:${address.port}/api/transcriptions`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

function audioForm(bytes: Uint8Array = new Uint8Array([1, 2, 3, 4])) {
  const form = new FormData();
  form.append("audio", new Blob([bytes], { type: "audio/wav" }), "conversation.wav");
  return form;
}

function markdownForm(markdown: string) {
  const form = new FormData();
  form.append("audio", new Blob([markdown], { type: "text/markdown" }), "conversation.md");
  return form;
}

test("transcription endpoint accepts multipart audio and returns the adapter result", async () => {
  await withServer(async input => {
    assert.equal(input.filename, "conversation.wav");
    assert.equal(input.mimeType, "audio/wav");
    assert.deepEqual([...input.bytes], [1, 2, 3, 4]);
    return adapted;
  }, async url => {
    const response = await fetch(url, { method: "POST", body: audioForm() });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), adapted);
  });
});

test("transcription endpoint accepts Markdown without an AssemblyAI connection", async () => {
  await withServer(undefined, async url => {
    const response = await fetch(url, {
      method: "POST",
      body: markdownForm("**Speaker A:** Hello.\n**Speaker B:** Hi there.")
    });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.deepEqual(result.speakers, [
      { id: "speaker_1", label: "Speaker A" },
      { id: "speaker_2", label: "Speaker B" }
    ]);
    assert.deepEqual(result.transcript, [
      { id: "segment_0001", speakerId: "speaker_1", text: "Hello." },
      { id: "segment_0002", speakerId: "speaker_2", text: "Hi there." }
    ]);

    const invalid = await fetch(url, {
      method: "POST",
      body: markdownForm("# Notes without speaker labels")
    });
    assert.equal(invalid.status, 400);
    assert.equal((await invalid.json()).error.code, "INVALID_MARKDOWN");
  });
});

test("transcription endpoint reports missing, unsupported, and oversized audio", async () => {
  await withServer(async () => adapted, async url => {
    const missing = await fetch(url, { method: "POST", body: new FormData() });
    assert.equal(missing.status, 400);
    assert.equal((await missing.json()).error.code, "INVALID_AUDIO");

    const unsupportedForm = new FormData();
    unsupportedForm.append("audio", new Blob(["text"], { type: "text/plain" }), "notes.txt");
    const unsupported = await fetch(url, { method: "POST", body: unsupportedForm });
    assert.equal(unsupported.status, 400);
    assert.equal((await unsupported.json()).error.code, "INVALID_AUDIO");

    const oversized = await fetch(url, {
      method: "POST",
      body: audioForm(new Uint8Array(25 * 1024 * 1024 + 1))
    });
    assert.equal(oversized.status, 413);
    assert.equal((await oversized.json()).error.code, "AUDIO_TOO_LARGE");
  });
});

test("transcription endpoint reports missing configuration and safe provider failures", async () => {
  await withServer(undefined, async url => {
    const response = await fetch(url, { method: "POST", body: audioForm() });
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error.code, "TRANSCRIPTION_NOT_CONFIGURED");
  });

  await withServer(async () => {
    throw new TranscriptionError("TRANSCRIPTION_FAILED", 502, "AssemblyAI transcription failed.");
  }, async url => {
    const response = await fetch(url, { method: "POST", body: audioForm() });
    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), {
      error: { code: "TRANSCRIPTION_FAILED", message: "AssemblyAI transcription failed." }
    });
  });
});
