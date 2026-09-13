import { createApp } from "./app.js";
import { analyzeStub, type Analyzer } from "./calibration.js";
import { createGroqAnalyzer, createGroqReviewCandidateFinder } from "./groq.js";
import { createAssemblyAiTranscriber } from "./assemblyai.js";
import { findReviewCandidatesStub, type ReviewCandidateFinder } from "./reviewCandidates.js";

const port = Number(process.env.PORT ?? 3001);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("PORT must be an integer from 1 to 65535.");
}
const host = process.env.HOST ?? "127.0.0.1";
const provider = process.env.ANALYSIS_PROVIDER ?? "auto";
if (!new Set(["auto", "stub", "groq"]).has(provider)) {
  throw new Error("ANALYSIS_PROVIDER must be auto, stub, or groq.");
}

const apiKey = process.env.GROQ_API_KEY?.trim();
if (provider === "groq" && !apiKey) {
  throw new Error("GROQ_API_KEY is required when ANALYSIS_PROVIDER=groq.");
}

const useGroq = provider === "groq" || (provider === "auto" && Boolean(apiKey));
const analyzer: Analyzer = useGroq
  ? createGroqAnalyzer({
      apiKey: apiKey!,
      model: process.env.GROQ_MODEL ?? "openai/gpt-oss-20b"
    })
  : analyzeStub;
const reviewCandidateFinder: ReviewCandidateFinder = useGroq
  ? createGroqReviewCandidateFinder({
      apiKey: apiKey!,
      model: process.env.GROQ_MODEL ?? "openai/gpt-oss-20b"
    })
  : findReviewCandidatesStub;

const assemblyAiApiKey = process.env.ASSEMBLYAI_API_KEY?.trim();
const transcriber = assemblyAiApiKey
  ? createAssemblyAiTranscriber({ apiKey: assemblyAiApiKey })
  : undefined;

const server = createApp(analyzer, process.env.FRONTEND_ORIGIN, transcriber, reviewCandidateFinder).listen(port, host, () => {
  console.log(`ConvoLens ${useGroq ? "Groq" : "deterministic stub"}: http://${host}:${port}/api/review-candidates`);
  console.log(`ConvoLens ${useGroq ? "Groq" : "deterministic stub"}: http://${host}:${port}/api/calibration`);
  console.log(`ConvoLens ${transcriber ? "AssemblyAI" : "transcription unavailable"}: http://${host}:${port}/api/transcriptions`);
});
server.on("error", () => {
  console.error("Backend could not start. Check PORT and whether it is already in use.");
  process.exitCode = 1;
});
