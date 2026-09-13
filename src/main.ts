type TranscriptSegment = {
  id: string;
  speakerId: string;
  text: string;
};

type Conversation = {
  userSpeakerId: string;
  participants: string[];
  transcript: TranscriptSegment[];
};

type TranscriptionResponse = {
  transcriptId: string;
  audioDurationSeconds: number | null;
  speakers: { id: string; label: string }[];
  participants: string[];
  transcript: TranscriptSegment[];
};

type AnalysisRequest = Conversation & {
  analysisTargetSegmentId: string;
  calibration?: {
    segmentId: string;
    userMeaning: string;
  };
};

type AnalysisItem = {
  segmentId: string;
  evidence: string;
  likelyConveyedMeaning: string;
  interpretation: string;
  clarificationQuestion: string;
  clarificationComparison: string | null;
  refinedFormulation: string;
};

type CalibrationResponse = {
  clarification?: {
    source: "user-provided";
    segmentId: string;
    userMeaning: string;
  };
  mode: "deterministic-stub" | "groq";
  disclaimer: string;
  userSpeakerId: string;
  segmentCount: number;
  observations: {
    segmentId: string;
    wordCount: number;
    tentativePhrases: string[];
  }[];
  analysis?: AnalysisItem[];
};

type ReviewCandidatesResponse = {
  mode: "deterministic-stub" | "groq";
  candidates: {
    segmentId: string;
    reason: string;
  }[];
};

type ErrorResponse = {
  error?: {
    message?: string;
  };
};

const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:3001")
  .replace(/\/+$/u, "");

const demoTranscription: TranscriptionResponse = {
  transcriptId: "demo",
  audioDurationSeconds: null,
  speakers: [
    { id: "speaker_1", label: "Speaker A" },
    { id: "speaker_2", label: "Speaker B" }
  ],
  participants: ["speaker_1", "speaker_2"],
  transcript: [
    {
      id: "segment_1",
      speakerId: "speaker_1",
      text: "What exactly are you proposing?"
    },
    {
      id: "segment_2",
      speakerId: "speaker_2",
      text: "I guess maybe we could look at doing it another way."
    },
    {
      id: "segment_3",
      speakerId: "speaker_1",
      text: "Do you have a particular alternative in mind?"
    },
    {
      id: "segment_4",
      speakerId: "speaker_2",
      text: "Something closer to the approach we talked about before."
    }
  ]
};

const transcriptContainer = document.getElementById("transcript") as HTMLDivElement;
const audioFileInput = document.getElementById("audioFile") as HTMLInputElement;
const startRecordingButton = document.getElementById("startRecordingButton") as HTMLButtonElement;
const stopRecordingButton = document.getElementById("stopRecordingButton") as HTMLButtonElement;
const recordingStatus = document.getElementById("recordingStatus") as HTMLDivElement;
const recordingPreview = document.getElementById("recordingPreview") as HTMLAudioElement;
const transcribeButton = document.getElementById("transcribeButton") as HTMLButtonElement;
const transcriptionStatus = document.getElementById("transcriptionStatus") as HTMLDivElement;
const userSpeakerSelect = document.getElementById("userSpeaker") as HTMLSelectElement;
const reviewStatus = document.getElementById("reviewStatus") as HTMLDivElement;
const reviewCandidates = document.getElementById("reviewCandidates") as HTMLDivElement;
const turnOverride = document.getElementById("turnOverride") as HTMLDetailsElement;
const targetSegmentSelect = document.getElementById("targetSegment") as HTMLSelectElement;
const selectedMoment = document.getElementById("selectedMoment") as HTMLElement;
const analyzeButton = document.getElementById("analyzeButton") as HTMLButtonElement;
const analysisContainer = document.getElementById("analysis") as HTMLDivElement;
const clarificationArea = document.getElementById("clarificationArea") as HTMLDivElement;
const clarificationQuestion = document.getElementById("clarificationQuestion") as HTMLDivElement;
const clarificationInput = document.getElementById("clarification") as HTMLTextAreaElement;
const calibrateButton = document.getElementById("calibrateButton") as HTMLButtonElement;
const calibrationResult = document.getElementById("calibrationResult") as HTMLDivElement;
const refinementResult = document.getElementById("refinementResult") as HTMLDivElement;
const refinedFormulation = document.getElementById("refinedFormulation") as HTMLElement;
const whyClearer = document.getElementById("whyClearer") as HTMLParagraphElement;
const exportButton = document.getElementById("exportButton") as HTMLButtonElement;
const exportStatus = document.getElementById("exportStatus") as HTMLDivElement;

if (
  transcriptContainer &&
  audioFileInput instanceof HTMLInputElement &&
  startRecordingButton instanceof HTMLButtonElement &&
  stopRecordingButton instanceof HTMLButtonElement &&
  recordingStatus &&
  recordingPreview instanceof HTMLAudioElement &&
  transcribeButton instanceof HTMLButtonElement &&
  transcriptionStatus &&
  userSpeakerSelect instanceof HTMLSelectElement &&
  reviewStatus &&
  reviewCandidates &&
  turnOverride instanceof HTMLDetailsElement &&
  targetSegmentSelect instanceof HTMLSelectElement &&
  selectedMoment &&
  analyzeButton instanceof HTMLButtonElement &&
  analysisContainer &&
  clarificationArea &&
  clarificationQuestion &&
  clarificationInput instanceof HTMLTextAreaElement &&
  calibrateButton instanceof HTMLButtonElement &&
  calibrationResult &&
  refinementResult &&
  refinedFormulation &&
  whyClearer &&
  exportButton instanceof HTMLButtonElement &&
  exportStatus
) {
  let transcription: TranscriptionResponse | null = null;
  let conversation: Conversation | null = null;
  let speakerLabels = new Map<string, string>();
  let suggestedTargetIds = new Set<string>();
  let selectedTargetId = "";
  let lastResult: CalibrationResponse | null = null;
  let lastClarificationQuestion = "";
  let candidateRequestVersion = 0;
  let mediaRecorder: MediaRecorder | null = null;
  let mediaStream: MediaStream | null = null;
  let recordedFile: File | null = null;
  let recordingUrl: string | null = null;

  const excerpt = (text: string, maxLength = 110) =>
    text.length <= maxLength ? text : `${text.slice(0, maxLength - 1).trimEnd()}…`;

  const getSpeakerLabel = (speakerId: string) => speakerLabels.get(speakerId) ?? speakerId;

  function selectedSegment() {
    return conversation?.transcript.find(segment => segment.id === selectedTargetId);
  }

  function renderTranscript(transcript: TranscriptSegment[], focusSpeakerId = "") {
    transcriptContainer.replaceChildren();

    if (transcript.length === 0) {
      const empty = document.createElement("p");
      empty.className = "empty-state";
      empty.textContent = "Your speaker-labelled transcript will appear here.";
      transcriptContainer.appendChild(empty);
      return;
    }

    const speakerIds = [...speakerLabels.keys()];
    for (const segment of transcript) {
      const item = document.createElement("article");
      const speakerIndex = Math.max(0, speakerIds.indexOf(segment.speakerId));
      item.className = `transcript-segment speaker-tone-${speakerIndex % 4}`;
      if (segment.speakerId === focusSpeakerId) item.classList.add("is-focus");
      if (segment.id === selectedTargetId) item.classList.add("is-selected");

      const label = document.createElement("strong");
      label.className = "speaker-label";
      label.textContent = getSpeakerLabel(segment.speakerId);

      const words = document.createElement("p");
      words.className = "segment-text";
      words.textContent = segment.text;

      const labelRow = document.createElement("div");
      labelRow.className = "speaker-label-row";
      labelRow.appendChild(label);
      if (suggestedTargetIds.has(segment.id)) {
        const badge = document.createElement("span");
        badge.className = "review-badge";
        badge.textContent = "Worth reviewing";
        labelRow.appendChild(badge);
        item.classList.add("is-suggested");
      }

      item.append(labelRow, words);
      transcriptContainer.appendChild(item);
    }
  }

  function resetReflection(message: string) {
    lastResult = null;
    lastClarificationQuestion = "";
    clarificationInput.value = "";
    clarificationQuestion.textContent = "";
    calibrationResult.textContent = "";
    refinedFormulation.textContent = "";
    whyClearer.textContent = "";
    exportStatus.textContent = "";
    clarificationArea.hidden = true;
    refinementResult.hidden = true;
    calibrateButton.disabled = true;
    exportButton.disabled = true;
    analysisContainer.textContent = message;
  }

  function clearReview(message: string) {
    candidateRequestVersion += 1;
    selectedTargetId = "";
    suggestedTargetIds = new Set();
    reviewStatus.textContent = message;
    reviewCandidates.replaceChildren();
    turnOverride.hidden = true;
    turnOverride.open = false;
    targetSegmentSelect.replaceChildren();
    const option = document.createElement("option");
    option.value = "";
    option.textContent = message;
    targetSegmentSelect.appendChild(option);
    targetSegmentSelect.disabled = true;
    selectedMoment.textContent = "Choose one of the suggested parts above.";
    analyzeButton.disabled = true;
    resetReflection("Choose a speaker and a part of the conversation to begin.");
  }

  function populateSpeakerOptions(result: TranscriptionResponse) {
    userSpeakerSelect.replaceChildren();
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "Choose a speaker";
    userSpeakerSelect.appendChild(placeholder);

    for (const speaker of result.speakers) {
      const firstTurn = result.transcript.find(segment => segment.speakerId === speaker.id);
      const option = document.createElement("option");
      option.value = speaker.id;
      option.textContent = firstTurn
        ? `${speaker.label} — “${excerpt(firstTurn.text, 76)}”`
        : speaker.label;
      userSpeakerSelect.appendChild(option);
    }
    userSpeakerSelect.disabled = false;
  }

  function loadTranscription(result: TranscriptionResponse, message: string) {
    transcription = result;
    conversation = null;
    speakerLabels = new Map(result.speakers.map(speaker => [speaker.id, speaker.label]));
    clearReview("Choose a focus speaker first.");
    renderTranscript(result.transcript);
    populateSpeakerOptions(result);
    transcriptionStatus.textContent = message;
  }

  function resetTranscription() {
    transcription = null;
    conversation = null;
    speakerLabels = new Map();
    userSpeakerSelect.replaceChildren();
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "Transcribe audio first";
    userSpeakerSelect.appendChild(option);
    userSpeakerSelect.disabled = true;
    clearReview("Choose a focus speaker first.");
    renderTranscript([]);
  }

  function populateAllTurnOptions(speakerId: string) {
    if (!transcription) return;
    const turns = transcription.transcript.filter(segment => segment.speakerId === speakerId);
    targetSegmentSelect.replaceChildren();
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "Choose any turn";
    targetSegmentSelect.appendChild(placeholder);
    turns.forEach((segment, index) => {
      const option = document.createElement("option");
      option.value = segment.id;
      option.textContent = `Turn ${index + 1} — “${excerpt(segment.text, 80)}”`;
      targetSegmentSelect.appendChild(option);
    });
    targetSegmentSelect.disabled = turns.length === 0;
    turnOverride.hidden = turns.length === 0;
  }

  function selectTarget(segmentId: string) {
    if (!conversation?.transcript.some(segment =>
      segment.id === segmentId && segment.speakerId === conversation?.userSpeakerId
    )) return;

    selectedTargetId = segmentId;
    targetSegmentSelect.value = segmentId;
    const segment = selectedSegment();
    selectedMoment.textContent = segment
      ? `${getSpeakerLabel(segment.speakerId)}: “${segment.text}”`
      : "Choose a part of the conversation.";
    analyzeButton.disabled = !segment;
    for (const button of reviewCandidates.querySelectorAll<HTMLButtonElement>("button[data-segment-id]")) {
      const selected = button.dataset.segmentId === segmentId;
      button.classList.toggle("is-selected", selected);
      button.setAttribute("aria-pressed", String(selected));
    }
    renderTranscript(conversation.transcript, conversation.userSpeakerId);
    resetReflection("Select “See what ConvoLens understood” to review this part.");
  }

  function renderReviewCandidates(result: ReviewCandidatesResponse) {
    if (!conversation) return;
    const segmentById = new Map(conversation.transcript.map(segment => [segment.id, segment]));
    const candidates = result.candidates.filter(candidate =>
      segmentById.get(candidate.segmentId)?.speakerId === conversation?.userSpeakerId
    );
    suggestedTargetIds = new Set(candidates.map(candidate => candidate.segmentId));
    reviewCandidates.replaceChildren();

    if (candidates.length === 0) {
      reviewStatus.textContent = "No specific parts were suggested. You can still choose any turn below.";
      turnOverride.open = true;
      renderTranscript(conversation.transcript, conversation.userSpeakerId);
      return;
    }

    reviewStatus.textContent = `ConvoLens found ${candidates.length} ${candidates.length === 1 ? "part" : "parts"} of the conversation that may be worth reviewing.`;
    candidates.forEach((candidate, index) => {
      const segment = segmentById.get(candidate.segmentId);
      if (!segment) return;

      const button = document.createElement("button");
      button.type = "button";
      button.className = "review-candidate";
      button.dataset.segmentId = candidate.segmentId;
      button.setAttribute("aria-pressed", "false");

      const number = document.createElement("span");
      number.className = "candidate-number";
      number.textContent = `Part ${index + 1}`;
      const quote = document.createElement("span");
      quote.className = "candidate-quote";
      quote.textContent = `“${excerpt(segment.text)}”`;
      const reason = document.createElement("span");
      reason.className = "candidate-reason";
      reason.textContent = candidate.reason;
      button.append(number, quote, reason);
      reviewCandidates.appendChild(button);
    });
    renderTranscript(conversation.transcript, conversation.userSpeakerId);
  }

  function makeRequest(userMeaning?: string): AnalysisRequest | null {
    if (!conversation || !selectedTargetId) return null;
    return {
      ...conversation,
      analysisTargetSegmentId: selectedTargetId,
      ...(userMeaning ? {
        calibration: { segmentId: selectedTargetId, userMeaning }
      } : {})
    };
  }

  async function postJson<T>(path: string, body: unknown, fallback: string) {
    const response = await fetch(`${apiBaseUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const result = await response.json() as T & ErrorResponse;
    if (!response.ok) throw new Error(result.error?.message ?? fallback);
    return result;
  }

  function currentAnalysis(result: CalibrationResponse) {
    return result.analysis?.find(item => item.segmentId === selectedTargetId);
  }

  function renderMeaning(result: CalibrationResponse) {
    const segment = selectedSegment();
    const modelAnalysis = currentAnalysis(result);
    analysisContainer.replaceChildren();

    if (!segment) {
      analysisContainer.textContent = "Choose a part of the conversation first.";
      return;
    }

    const saidLabel = document.createElement("p");
    saidLabel.className = "result-label";
    saidLabel.textContent = `${getSpeakerLabel(segment.speakerId)} said`;
    const said = document.createElement("blockquote");
    said.className = "meaning-quote";
    said.textContent = `“${segment.text}”`;
    const understoodLabel = document.createElement("p");
    understoodLabel.className = "result-label";
    understoodLabel.textContent = "ConvoLens understood";
    const understood = document.createElement("p");
    understood.className = "understood-text";
    understood.textContent = modelAnalysis?.likelyConveyedMeaning
      ?? "Only the deterministic wording check is available. Connect Groq for a contextual interpretation.";
    analysisContainer.append(saidLabel, said, understoodLabel, understood);
  }

  function errorMessage(error: unknown, fallback: string) {
    if (error instanceof TypeError) return "Cannot reach the service. Please try again shortly.";
    return error instanceof Error ? error.message : fallback;
  }

  function stopMediaStream() {
    mediaStream?.getTracks().forEach(track => track.stop());
    mediaStream = null;
  }

  function clearRecording() {
    recordedFile = null;
    if (recordingUrl) URL.revokeObjectURL(recordingUrl);
    recordingUrl = null;
    recordingPreview.pause();
    recordingPreview.removeAttribute("src");
    recordingPreview.load();
    recordingPreview.hidden = true;
  }

  function getRecordingMimeType() {
    return ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"]
      .find(type => MediaRecorder.isTypeSupported(type));
  }

  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
    startRecordingButton.disabled = true;
    recordingStatus.textContent = "This browser does not support audio recording.";
  }

  startRecordingButton.addEventListener("click", async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStream = stream;
      const mimeType = getRecordingMimeType();
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);
      const chunks: Blob[] = [];

      clearRecording();
      resetTranscription();
      transcriptionStatus.textContent = "";
      audioFileInput.value = "";
      audioFileInput.disabled = true;
      mediaRecorder = recorder;

      recorder.addEventListener("dataavailable", event => {
        if (event.data.size > 0) chunks.push(event.data);
      });

      recorder.addEventListener("stop", () => {
        const finalType = recorder.mimeType || chunks[0]?.type || "audio/webm";
        const blob = new Blob(chunks, { type: finalType });

        stopMediaStream();
        mediaRecorder = null;
        audioFileInput.disabled = false;
        startRecordingButton.disabled = false;
        stopRecordingButton.disabled = true;

        if (blob.size === 0) {
          recordingStatus.textContent = "No audio was captured. Please try again.";
          transcribeButton.disabled = false;
          return;
        }

        const extension = finalType.includes("mp4") ? "m4a" : finalType.includes("ogg") ? "ogg" : "webm";
        recordedFile = new File([blob], `convolens-recording-${Date.now()}.${extension}`, { type: finalType });
        recordingUrl = URL.createObjectURL(blob);
        recordingPreview.src = recordingUrl;
        recordingPreview.hidden = false;
        recordingStatus.textContent = "Recording ready. Preview it or transcribe it.";
        transcribeButton.disabled = false;
      });

      recorder.addEventListener("error", () => {
        stopMediaStream();
        mediaRecorder = null;
        audioFileInput.disabled = false;
        startRecordingButton.disabled = false;
        stopRecordingButton.disabled = true;
        transcribeButton.disabled = false;
        recordingStatus.textContent = "Recording failed. Please try again or upload audio.";
      });

      recorder.start(1_000);
      startRecordingButton.disabled = true;
      stopRecordingButton.disabled = false;
      transcribeButton.disabled = true;
      recordingStatus.textContent = "Recording… speak naturally, then select Stop.";
    } catch (error) {
      stopMediaStream();
      const reason = error instanceof DOMException ? error.name : "";
      recordingStatus.textContent = reason === "NotAllowedError"
        ? "Microphone access was not allowed. Enable it or upload audio."
        : reason === "NotFoundError"
          ? "No microphone was found. Connect one or upload audio."
          : "Could not start recording. Please try again or upload audio.";
    }
  });

  stopRecordingButton.addEventListener("click", () => {
    if (mediaRecorder?.state === "recording") {
      stopRecordingButton.disabled = true;
      recordingStatus.textContent = "Finishing recording…";
      mediaRecorder.stop();
    }
  });

  audioFileInput.addEventListener("change", () => {
    const file = audioFileInput.files?.[0];
    if (!file) return;
    clearRecording();
    resetTranscription();
    transcriptionStatus.textContent = "";
    recordingStatus.textContent = `${file.name} selected for transcription.`;
  });

  window.addEventListener("beforeunload", () => {
    stopMediaStream();
    if (recordingUrl) URL.revokeObjectURL(recordingUrl);
  });

  transcribeButton.addEventListener("click", async () => {
    const file = recordedFile ?? audioFileInput.files?.[0];
    if (!file) {
      transcriptionStatus.textContent = "Upload or record audio first.";
      return;
    }

    const formData = new FormData();
    formData.append("audio", file);
    transcribeButton.disabled = true;
    startRecordingButton.disabled = true;
    audioFileInput.disabled = true;
    userSpeakerSelect.disabled = true;
    transcriptionStatus.textContent = "Transcribing and separating speakers…";

    try {
      const response = await fetch(`${apiBaseUrl}/api/transcriptions`, {
        method: "POST",
        body: formData
      });
      const result = await response.json() as TranscriptionResponse & ErrorResponse;
      if (!response.ok) throw new Error(result.error?.message ?? "Transcription failed.");

      loadTranscription(
        result,
        `Transcription ready: ${result.transcript.length} turns. Read the transcript, then choose a focus speaker.`
      );
    } catch (error) {
      transcriptionStatus.textContent = errorMessage(error, "Transcription failed.");
    } finally {
      transcribeButton.disabled = false;
      startRecordingButton.disabled = false;
      audioFileInput.disabled = false;
    }
  });

  userSpeakerSelect.addEventListener("change", async () => {
    if (!transcription || !userSpeakerSelect.value) {
      conversation = null;
      clearReview("Choose a focus speaker first.");
      renderTranscript(transcription?.transcript ?? []);
      return;
    }

    conversation = {
      userSpeakerId: userSpeakerSelect.value,
      participants: transcription.participants,
      transcript: transcription.transcript
    };
    const requestConversation = conversation;
    const requestVersion = ++candidateRequestVersion;
    selectedTargetId = "";
    suggestedTargetIds = new Set();
    populateAllTurnOptions(conversation.userSpeakerId);
    reviewCandidates.replaceChildren();
    reviewStatus.textContent = "Finding parts of the conversation worth reviewing…";
    selectedMoment.textContent = "Choose one of the suggested parts above.";
    resetReflection("ConvoLens is looking for possible communication gaps.");
    renderTranscript(transcription.transcript, conversation.userSpeakerId);
    transcriptionStatus.textContent = `${getSpeakerLabel(conversation.userSpeakerId)} selected as the focus speaker.`;

    try {
      const result = await postJson<ReviewCandidatesResponse>(
        "/api/review-candidates",
        requestConversation,
        "Could not find parts worth reviewing."
      );
      if (requestVersion !== candidateRequestVersion) return;
      renderReviewCandidates(result);
      resetReflection("Choose one suggested part, then see what ConvoLens understood.");
    } catch (error) {
      if (requestVersion !== candidateRequestVersion) return;
      reviewStatus.textContent = `${errorMessage(error, "Suggestions failed.")} You can still choose any turn below.`;
      turnOverride.open = true;
      resetReflection("Choose a turn manually to continue.");
    }
  });

  reviewCandidates.addEventListener("click", event => {
    const button = (event.target as Element).closest<HTMLButtonElement>("button[data-segment-id]");
    if (button?.dataset.segmentId) selectTarget(button.dataset.segmentId);
  });

  targetSegmentSelect.addEventListener("change", () => {
    if (targetSegmentSelect.value) selectTarget(targetSegmentSelect.value);
  });

  analyzeButton.addEventListener("click", async () => {
    const request = makeRequest();
    if (!request) {
      analysisContainer.textContent = "Choose a speaker and a part of the conversation first.";
      return;
    }

    analyzeButton.disabled = true;
    calibrateButton.disabled = true;
    exportButton.disabled = true;
    clarificationArea.hidden = true;
    refinementResult.hidden = true;
    analysisContainer.textContent = "Reading this part in its conversational context…";

    try {
      const result = await postJson<CalibrationResponse>("/api/calibration", request, "Analysis failed.");
      lastResult = result;
      renderMeaning(result);
      const modelAnalysis = currentAnalysis(result);
      lastClarificationQuestion = modelAnalysis?.clarificationQuestion
        ?? "Does this wording capture what you meant, or was there a more specific idea behind it?";
      clarificationQuestion.textContent = lastClarificationQuestion;
      clarificationArea.hidden = false;
      calibrationResult.textContent = result.mode === "groq"
        ? "Add your intended meaning so ConvoLens can compare it with what your words conveyed."
        : "Groq is not connected, so only the wording check is available.";
      calibrateButton.disabled = clarificationInput.value.trim().length === 0;
    } catch (error) {
      analysisContainer.textContent = errorMessage(error, "Analysis failed.");
    } finally {
      analyzeButton.disabled = !selectedSegment();
    }
  });

  clarificationInput.addEventListener("input", () => {
    calibrateButton.disabled = !lastResult || clarificationInput.value.trim().length === 0;
  });

  calibrateButton.addEventListener("click", async () => {
    const intendedMeaning = clarificationInput.value.trim();
    if (!intendedMeaning) {
      calibrationResult.textContent = "Describe what you intended to communicate first.";
      clarificationInput.focus();
      return;
    }
    const request = makeRequest(intendedMeaning);
    if (!request) {
      calibrationResult.textContent = "Choose and analyze a part of the conversation first.";
      return;
    }

    analyzeButton.disabled = true;
    calibrateButton.disabled = true;
    exportButton.disabled = true;
    refinementResult.hidden = true;
    calibrationResult.textContent = "Using the selected turn, its surrounding context, and your intended meaning…";

    try {
      const result = await postJson<CalibrationResponse>("/api/calibration", request, "Refinement failed.");
      lastResult = result;
      renderMeaning(result);
      const modelAnalysis = currentAnalysis(result);
      if (!modelAnalysis) {
        calibrationResult.textContent = "Context-aware refinement requires Groq. The backend is currently using its deterministic fallback.";
        return;
      }
      refinedFormulation.textContent = `“${modelAnalysis.refinedFormulation}”`;
      whyClearer.textContent = modelAnalysis.clarificationComparison ?? modelAnalysis.interpretation;
      refinementResult.hidden = false;
      exportButton.disabled = false;
      calibrationResult.textContent = "Refinement ready.";
    } catch (error) {
      calibrationResult.textContent = errorMessage(error, "Refinement failed.");
    } finally {
      analyzeButton.disabled = !selectedSegment();
      calibrateButton.disabled = clarificationInput.value.trim().length === 0;
    }
  });

  exportButton.addEventListener("click", () => {
    const segment = selectedSegment();
    const modelAnalysis = lastResult ? currentAnalysis(lastResult) : undefined;
    if (!lastResult?.clarification || !conversation || !segment || !modelAnalysis) return;

    const lines = [
      "# ConvoLens reflection",
      "",
      `Generated: ${new Date().toLocaleString()}`,
      `Focus speaker: ${getSpeakerLabel(conversation.userSpeakerId)}`,
      "",
      "## What was said",
      "",
      segment.text,
      "",
      "## What ConvoLens understood",
      "",
      modelAnalysis.likelyConveyedMeaning,
      "",
      "## Clarification question",
      "",
      lastClarificationQuestion || modelAnalysis.clarificationQuestion,
      "",
      "## What I meant",
      "",
      lastResult.clarification.userMeaning,
      "",
      "## A clearer way to say it",
      "",
      modelAnalysis.refinedFormulation,
      "",
      "## Why this is clearer",
      "",
      modelAnalysis.clarificationComparison ?? modelAnalysis.interpretation,
      "",
      "## Full transcript",
      "",
      ...conversation.transcript.map(turn => `- **${getSpeakerLabel(turn.speakerId)}:** ${turn.text}`),
      "",
      `_${lastResult.disclaimer}_`
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `convolens-reflection-${new Date().toISOString().slice(0, 10)}.md`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
    exportStatus.textContent = "Reflection exported as a Markdown file.";
  });

  loadTranscription(
    demoTranscription,
    "Example transcript loaded. Choose a speaker to explore it, or add your own audio."
  );
}
