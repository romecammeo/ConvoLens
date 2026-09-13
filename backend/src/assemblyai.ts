import { AssemblyAI } from "assemblyai";
import {
  TranscriptionError,
  adaptAssemblyAiTranscript,
  type Transcriber
} from "./transcription.js";

type AssemblyAiOptions = {
  apiKey: string;
  pollingTimeoutMs?: number;
};

export function createAssemblyAiTranscriber(options: AssemblyAiOptions): Transcriber {
  const client = new AssemblyAI({ apiKey: options.apiKey });

  return async input => {
    try {
      const transcript = await client.transcripts.transcribe({
        audio: input.bytes,
        speech_models: ["universal-3-pro", "universal-2"],
        language_detection: true,
        speaker_labels: true,
        speakers_expected: 2
      }, {
        pollingInterval: 1_000,
        pollingTimeout: options.pollingTimeoutMs ?? 120_000
      });

      return adaptAssemblyAiTranscript(transcript);
    } catch (error) {
      if (error instanceof TranscriptionError) throw error;
      const timedOut = error instanceof Error && /timeout/i.test(error.message);
      throw new TranscriptionError(
        "TRANSCRIPTION_FAILED",
        502,
        timedOut ? "AssemblyAI transcription timed out." : "AssemblyAI transcription failed."
      );
    }
  };
}
