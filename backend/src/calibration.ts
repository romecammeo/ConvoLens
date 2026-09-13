import { z } from "zod";

const id = z.string().trim().min(1).max(100);
export const conversationSchema = z.object({
  calibration: z.object({ segmentId: id, userMeaning: z.string().trim().min(1).max(10000) }).strict().optional(),
  userSpeakerId: id,
  participants: z.array(id).min(1).max(20),
  transcript: z.array(z.object({
    id, speakerId: id, text: z.string().trim().min(1).max(10000)
  }).strict()).min(1).max(500)
}).strict().superRefine((value, ctx) => {
  const issue = (path: (string | number)[], message: string) =>
    ctx.addIssue({ code: "custom", path, message });
  if (new Set(value.participants).size !== value.participants.length)
    issue(["participants"], "Participant IDs must be unique.");
  if (!value.participants.includes(value.userSpeakerId))
    issue(["userSpeakerId"], "Must be a participant.");
  if (value.calibration) {
    const selected = value.transcript.find(s => s.id === value.calibration!.segmentId);
    if (!selected || selected.speakerId !== value.userSpeakerId)
      issue(["calibration", "segmentId"], "Must identify a segment belonging to userSpeakerId.");
  }
  const seen = new Set<string>();
  value.transcript.forEach((segment, index) => {
    if (!value.participants.includes(segment.speakerId))
      issue(["transcript", index, "speakerId"], "Must be a participant.");
    if (seen.has(segment.id))
      issue(["transcript", index, "id"], "Segment IDs must be unique.");
    seen.add(segment.id);
  });
  if (!value.transcript.some(s => s.speakerId === value.userSpeakerId))
    issue(["transcript"], "Must contain a segment by userSpeakerId.");
});

export type Conversation = z.infer<typeof conversationSchema>;
export const groqAnalysisSchema = z.object({
  analysis: z.array(z.object({
    segmentId: id,
    evidence: z.string().trim().min(1).max(2000),
    likelyConveyedMeaning: z.string().trim().min(1).max(4000),
    interpretation: z.string().trim().min(1).max(4000),
    clarificationComparison: z.string().trim().min(1).max(4000).nullable(),
    refinedFormulation: z.string().trim().min(1).max(4000)
  }).strict()).min(1).max(500)
}).strict();

export type GroqAnalysis = z.infer<typeof groqAnalysisSchema>["analysis"];
export type CalibrationResult = {
  clarification?: { source: "user-provided"; segmentId: string; userMeaning: string };
  mode: "deterministic-stub" | "groq";
  disclaimer: string;
  userSpeakerId: string;
  segmentCount: number;
  observations: { segmentId: string; wordCount: number; tentativePhrases: string[] }[];
  analysis?: GroqAnalysis;
};
// Future Groq adapter implements this boundary; the route and frontend contract stay stable.
export type Analyzer = (conversation: Conversation) => Promise<CalibrationResult>;

export const analyzeStub: Analyzer = async (conversation) => ({
  ...(conversation.calibration ? { clarification: { source: "user-provided" as const, ...conversation.calibration } } : {}),
  mode: "deterministic-stub",
  disclaimer: "Text pattern demo only; not AI analysis or a judgment of communication ability.",
  userSpeakerId: conversation.userSpeakerId,
  segmentCount: conversation.transcript.length,
  observations: conversation.transcript
    .filter(segment => segment.speakerId === conversation.userSpeakerId)
    .map(segment => ({
      segmentId: segment.id,
      wordCount: segment.text.split(/\s+/u).length,
      tentativePhrases: ["i guess", "maybe", "could"].filter(phrase =>
        new RegExp("\\b" + phrase + "\\b", "i").test(segment.text))
    }))
});

export class AnalysisError extends Error {
  constructor(
    public readonly code: "PROVIDER_TIMEOUT" | "PROVIDER_RATE_LIMIT" | "PROVIDER_UNAVAILABLE" | "INVALID_PROVIDER_OUTPUT",
    public readonly status: 429 | 502 | 503 | 504,
    message: string
  ) {
    super(message);
  }
}
