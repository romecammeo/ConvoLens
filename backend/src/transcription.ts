import { z } from "zod";

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
    public readonly code: "INVALID_AUDIO" | "AUDIO_TOO_LARGE" | "TRANSCRIPTION_NOT_CONFIGURED" | "TRANSCRIPTION_FAILED" | "INVALID_TRANSCRIPTION",
    public readonly status: 400 | 413 | 502 | 503,
    message: string
  ) {
    super(message);
  }
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
