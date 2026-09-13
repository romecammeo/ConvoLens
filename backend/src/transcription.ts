import { z } from "zod";
import { createHash } from "node:crypto";

const assemblyAiTranscriptSchema = z.object({
  id: z.string().min(1),
  status: z.enum(["queued", "processing", "completed", "error"]),
  error: z.string().optional(),
  audio_duration: z.number().nonnegative().nullable().optional(),
  utterances: z.array(z.object({
    speaker: z.string().min(1),
    text: z.string(),
    start: z.number().nonnegative(),
    end: z.number().nonnegative()
  }).passthrough()).nullable().optional()
}).passthrough();

export type TranscriptionInput = {
  bytes: Buffer;
  filename: string;
  mimeType: string;
};

export type TranscriptionResult = {
  transcriptId: string;
  audioDurationSeconds: number | null;
  speakers: { id: string; label: string }[];
  participants: string[];
  transcript: { id: string; speakerId: string; text: string }[];
};

export type Transcriber = (input: TranscriptionInput) => Promise<TranscriptionResult>;

export class TranscriptionError extends Error {
  constructor(
    public readonly code: "INVALID_AUDIO" | "INVALID_MARKDOWN" | "AUDIO_TOO_LARGE" | "TRANSCRIPTION_NOT_CONFIGURED" | "TRANSCRIPTION_FAILED" | "INVALID_TRANSCRIPTION",
    public readonly status: 400 | 413 | 502 | 503,
    message: string
  ) {
    super(message);
  }
}

export function adaptMarkdownTranscript(bytes: Buffer): TranscriptionResult {
  const markdown = bytes.toString("utf8").replace(/^\uFEFF/u, "");
  if (!markdown.trim() || markdown.includes("\u0000")) {
    throw new TranscriptionError("INVALID_MARKDOWN", 400, "The Markdown transcript is empty or unreadable.");
  }

  const allLines = markdown.split(/\r?\n/u);
  const transcriptHeadingIndex = allLines.findIndex(line =>
    /^#{1,6}\s+(?:full\s+)?transcript\s*$/iu.test(line.trim())
  );
  const transcriptSection = transcriptHeadingIndex >= 0
    ? allLines.slice(transcriptHeadingIndex + 1)
    : allLines;
  const nextHeadingIndex = transcriptSection.findIndex(line => /^#{1,6}\s+/u.test(line.trim()));
  const lines = nextHeadingIndex >= 0 ? transcriptSection.slice(0, nextHeadingIndex) : transcriptSection;

  const speakerIds = new Map<string, { id: string; label: string }>();
  const transcript: TranscriptionResult["transcript"] = [];
  const labelledLine = /^(?:>\s*)?(?:[-+]\s+)?(?:\*\*|__)?([^:\n]{1,100}?):(?:\*\*|__)?\s+(.+)$/u;

  for (const line of lines) {
    const match = line.trim().match(labelledLine);
    if (!match) continue;
    const label = match[1]?.trim();
    const text = match[2]?.trim();
    if (!label || !text || /^#{1,6}\s/u.test(label)) continue;

    const key = label.toLocaleLowerCase();
    let speaker = speakerIds.get(key);
    if (!speaker) {
      speaker = { id: `speaker_${speakerIds.size + 1}`, label };
      speakerIds.set(key, speaker);
    }
    transcript.push({
      id: `segment_${String(transcript.length + 1).padStart(4, "0")}`,
      speakerId: speaker.id,
      text
    });
  }

  if (transcript.length === 0) {
    throw new TranscriptionError(
      "INVALID_MARKDOWN",
      400,
      "Use speaker-labelled lines such as ‘Speaker A: Hello.’ in the Markdown transcript."
    );
  }

  const speakers = [...speakerIds.values()];
  return {
    transcriptId: `markdown_${createHash("sha256").update(bytes).digest("hex").slice(0, 12)}`,
    audioDurationSeconds: null,
    speakers,
    participants: speakers.map(speaker => speaker.id),
    transcript
  };
}

export function adaptAssemblyAiTranscript(value: unknown): TranscriptionResult {
  const parsed = assemblyAiTranscriptSchema.safeParse(value);
  if (!parsed.success) {
    throw new TranscriptionError("INVALID_TRANSCRIPTION", 502, "AssemblyAI returned an invalid transcript.");
  }

  if (parsed.data.status === "error") {
    throw new TranscriptionError("TRANSCRIPTION_FAILED", 502, "AssemblyAI could not transcribe the audio.");
  }

  if (parsed.data.status !== "completed" || !parsed.data.utterances?.length) {
    throw new TranscriptionError("INVALID_TRANSCRIPTION", 502, "AssemblyAI returned no speaker-labelled utterances.");
  }

  const speakerIds = new Map<string, string>();
  const transcript = parsed.data.utterances
    .map(utterance => ({ ...utterance, text: utterance.text.trim() }))
    .filter(utterance => utterance.text.length > 0)
    .map((utterance, index) => {
      let speakerId = speakerIds.get(utterance.speaker);
      if (!speakerId) {
        speakerId = `speaker_${speakerIds.size + 1}`;
        speakerIds.set(utterance.speaker, speakerId);
      }
      return {
        id: `segment_${String(index + 1).padStart(4, "0")}`,
        speakerId,
        text: utterance.text
      };
    });

  if (transcript.length === 0 || speakerIds.size === 0) {
    throw new TranscriptionError("INVALID_TRANSCRIPTION", 502, "AssemblyAI returned no usable speech.");
  }

  const speakers = [...speakerIds].map(([providerLabel, id]) => ({
    id,
    label: `Speaker ${providerLabel}`
  }));

  return {
    transcriptId: parsed.data.id,
    audioDurationSeconds: parsed.data.audio_duration ?? null,
    speakers,
    participants: speakers.map(speaker => speaker.id),
    transcript
  };
}
