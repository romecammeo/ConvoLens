import { z } from "zod";
import type { Conversation } from "./calibration.js";

export const reviewCandidatesSchema = z.object({
  candidates: z.array(z.object({
    segmentId: z.string().trim().min(1).max(100),
    reason: z.string().trim().min(1).max(500)
  }).strict()).min(1).max(4)
}).strict();

export type ReviewCandidate = z.infer<typeof reviewCandidatesSchema>["candidates"][number];
export type ReviewCandidateResult = {
  mode: "deterministic-stub" | "groq";
  candidates: ReviewCandidate[];
};
export type ReviewCandidateFinder = (conversation: Conversation) => Promise<ReviewCandidateResult>;

const signals = [
  "i guess", "maybe", "sort of", "kind of", "perhaps", "probably",
  "not sure", "could", "might", "something", "stuff", "whatever"
];

export const findReviewCandidatesStub: ReviewCandidateFinder = async conversation => {
  const candidates = conversation.transcript
    .filter(segment => segment.speakerId === conversation.userSpeakerId)
    .map(segment => {
      const normalized = segment.text.toLocaleLowerCase();
      const wordCount = segment.text.trim().split(/\s+/u).length;
      const matchedSignals = signals.filter(signal => normalized.includes(signal));
      const vagueReference = /\b(this|that|it|things)\b/u.test(normalized);
      const score = matchedSignals.length * 3 + (wordCount <= 4 ? 1 : 0) + (vagueReference ? 1 : 0);
      const reason = matchedSignals.length > 0
        ? "Tentative wording may leave the speaker's position unclear."
        : wordCount <= 4
          ? "This brief turn may rely on meaning that was left unstated."
          : vagueReference
            ? "A reference in this turn may depend on unstated context."
            : "This substantive turn may be useful to review in context.";
      return { segmentId: segment.id, reason, score, length: segment.text.length };
    })
    .sort((a, b) => b.score - a.score || b.length - a.length)
    .slice(0, 4)
    .map(({ segmentId, reason }) => ({ segmentId, reason }));

  return { mode: "deterministic-stub", candidates };
};
