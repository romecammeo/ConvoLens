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
const targetSegmentSelect = document.getElementById("targetSegment") as HTMLSelectElement;
const selectedUtterance = document.getElementById("selectedUtterance") as HTMLElement;
const analyzeButton = document.getElementById("analyzeButton") as HTMLButtonElement;
const clarificationQuestion = document.getElementById("clarificationQuestion") as HTMLDivElement;
const clarificationInput = document.getElementById("clarification") as HTMLTextAreaElement;
const calibrateButton = document.getElementById("calibrateButton") as HTMLButtonElement;
const analysisContainer = document.getElementById("analysis") as HTMLDivElement;
const calibrationResult = document.getElementById("calibrationResult") as HTMLDivElement;
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
  targetSegmentSelect instanceof HTMLSelectElement &&
  selectedUtterance &&
  analyzeButton instanceof HTMLButtonElement &&
  clarificationQuestion &&
  clarificationInput instanceof HTMLTextAreaElement &&
  calibrateButton instanceof HTMLButtonElement &&
  analysisContainer &&
  calibrationResult &&
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
  let mediaRecorder: MediaRecorder | null = null;
  let mediaStream: MediaStream | null = null;
  let recordedFile: File | null = null;
  let recordingUrl: string | null = null;

  const excerpt = (text: string, maxLength = 92) =>
    text.length <= maxLength ? text : `${text.slice(0, maxLength - 1).trimEnd()}…`;

  const getSpeakerLabel = (speakerId: string) => speakerLabels.get(speakerId) ?? speakerId;

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
        badge.textContent = "Suggested";
        labelRow.appendChild(badge);
        item.classList.add("is-suggested");
      }

      item.append(labelRow, words);
      transcriptContainer.appendChild(item);
    }
  }

  function clearAnalysis(message: string) {
    selectedTargetId = "";
    lastResult = null;
    lastClarificationQuestion = "";
    suggestedTargetIds = new Set();
    targetSegmentSelect.replaceChildren();
    const option = document.createElement("option");
    option.value = "";
    option.textContent = message;
    targetSegmentSelect.appendChild(option);
    targetSegmentSelect.disabled = true;
    selectedUtterance.textContent = "Your selected utterance will appear here.";
    analysisContainer.textContent = "Choose a speaker and one of their utterances.";
    clarificationQuestion.textContent = "Analyze an utterance to receive a contextual clarification question.";
    calibrationResult.textContent = "";
    exportStatus.textContent = "";
    clarificationInput.value = "";
    analyzeButton.disabled = true;
    calibrateButton.disabled = true;
    exportButton.disabled = true;
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
        ? `${speaker.label} — “${excerpt(firstTurn.text)}”`
        : speaker.label;
      userSpeakerSelect.appendChild(option);
    }
    userSpeakerSelect.disabled = false;
  }

  function loadTranscription(result: TranscriptionResponse, message: string) {
    transcription = result;
    conversation = null;
    speakerLabels = new Map(result.speakers.map(speaker => [speaker.id, speaker.label]));
    clearAnalysis("Choose a speaker first");
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
    clearAnalysis("Choose a speaker first");
    renderTranscript([]);
  }

  function populateTargetOptions(speakerId: string) {
    if (!transcription) return;
    const turns = transcription.transcript.filter(segment => segment.speakerId === speakerId);
    const rankedTurns = turns
      .map(segment => ({ segment, score: scoreReviewValue(segment.text) }))
      .sort((a, b) => b.score - a.score || b.segment.text.length - a.segment.text.length);
    const suggestions = rankedTurns.filter(item => item.score > 0).slice(0, 3);
    suggestedTargetIds = new Set(
      (suggestions.length > 0 ? suggestions : rankedTurns.slice(0, 1))
        .map(item => item.segment.id)
    );
    targetSegmentSelect.replaceChildren();
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "Choose an utterance";
    targetSegmentSelect.appendChild(placeholder);
    turns.forEach((segment, index) => {
      const option = document.createElement("option");
      option.value = segment.id;
      const prefix = suggestedTargetIds.has(segment.id) ? "Suggested · " : "";
      option.textContent = `${prefix}Turn ${index + 1} — “${excerpt(segment.text)}”`;
      targetSegmentSelect.appendChild(option);
    });
    targetSegmentSelect.disabled = turns.length === 0;
  }

  function resetResultForTarget() {
    lastResult = null;
    lastClarificationQuestion = "";
    clarificationInput.value = "";
    calibrationResult.textContent = "";
    exportStatus.textContent = "";
    calibrateButton.disabled = true;
    exportButton.disabled = true;
    analyzeButton.disabled = !selectedSegment();
    analysisContainer.textContent = selectedTargetId
      ? "Select Analyze utterance to see what this wording conveyed."
      : "Choose one utterance to analyze.";
    clarificationQuestion.textContent = "Analyze an utterance to receive a contextual clarification question.";
  }

  function scoreReviewValue(text: string) {
    const normalized = text.toLocaleLowerCase();
    const wordCount = text.trim().split(/\s+/u).length;
    const highValuePhrases = [
      "i guess", "maybe", "sort of", "kind of", "perhaps", "probably",
      "not sure", "could", "might", "something", "stuff", "whatever"
    ];
    const phraseScore = highValuePhrases.reduce(
      (score, phrase) => score + (normalized.includes(phrase) ? 3 : 0),
      0
    );
    const shortAmbiguousScore = wordCount <= 4 ? 1 : 0;
    const vagueReferenceScore = /\b(this|that|it|things)\b/u.test(normalized) ? 1 : 0;
    return phraseScore + shortAmbiguousScore + vagueReferenceScore;
  }

  function selectedSegment() {
    return conversation?.transcript.find(segment => segment.id === selectedTargetId);
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

  async function requestAnalysis(request: AnalysisRequest) {
    const response = await fetch(`${apiBaseUrl}/api/calibration`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request)
    });
    const result = await response.json() as CalibrationResponse & ErrorResponse;
    if (!response.ok) throw new Error(result.error?.message ?? "Analysis failed.");
    return result;
  }

  function renderAnalysis(result: CalibrationResponse) {
    const modelAnalysis = result.analysis?.find(item => item.segmentId === selectedTargetId);
    analysisContainer.replaceChildren();

    if (!modelAnalysis) {
      const phrases = result.observations
        .flatMap(observation => observation.tentativePhrases)
        .join(", ");
      analysisContainer.textContent = phrases
        ? `Tentative phrasing found: ${phrases}.`
        : "No tentative phrasing was found.";
      return;
    }

    for (const [label, value] of [
      ["Evidence", modelAnalysis.evidence],
      ["Likely conveyed meaning", modelAnalysis.likelyConveyedMeaning],
      ["Interpretation", modelAnalysis.interpretation],
      ["Clarification comparison", modelAnalysis.clarificationComparison],
      ["Refined formulation", modelAnalysis.refinedFormulation]
    ]) {
      if (!value) continue;
      const paragraph = document.createElement("p");
      const heading = document.createElement("strong");
      heading.textContent = `${label}: `;
      paragraph.append(heading, value);
      analysisContainer.appendChild(paragraph);
    }
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
        `Transcription ready: ${result.transcript.length} turns. Review the excerpts, then choose a speaker.`
      );
    } catch (error) {
      transcriptionStatus.textContent = errorMessage(error, "Transcription failed.");
    } finally {
      transcribeButton.disabled = false;
      startRecordingButton.disabled = false;
      audioFileInput.disabled = false;
    }
  });

  userSpeakerSelect.addEventListener("change", () => {
    if (!transcription || !userSpeakerSelect.value) {
      conversation = null;
      clearAnalysis("Choose a speaker first");
      renderTranscript(transcription?.transcript ?? []);
      return;
    }

    conversation = {
      userSpeakerId: userSpeakerSelect.value,
      participants: transcription.participants,
      transcript: transcription.transcript
    };
    selectedTargetId = "";
    populateTargetOptions(userSpeakerSelect.value);
    resetResultForTarget();
    renderTranscript(transcription.transcript, userSpeakerSelect.value);
    const label = getSpeakerLabel(userSpeakerSelect.value);
    transcriptionStatus.textContent = `${label} selected for analysis. Choose one of the highlighted turns below.`;
  });

  targetSegmentSelect.addEventListener("change", () => {
    selectedTargetId = targetSegmentSelect.value;
    const segment = selectedSegment();
    selectedUtterance.textContent = segment
      ? `${getSpeakerLabel(segment.speakerId)}: “${segment.text}”`
      : "Your selected utterance will appear here.";
    resetResultForTarget();
  });

  analyzeButton.addEventListener("click", async () => {
    const request = makeRequest();
    if (!request) {
      analysisContainer.textContent = "Choose a speaker and utterance first.";
      return;
    }

    analyzeButton.disabled = true;
    calibrateButton.disabled = true;
    exportButton.disabled = true;
    analysisContainer.textContent = "Analyzing the selected wording…";
    calibrationResult.textContent = "";

    try {
      const result = await requestAnalysis(request);
      lastResult = result;
      renderAnalysis(result);
      lastClarificationQuestion = result.analysis?.find(item => item.segmentId === selectedTargetId)
        ?.clarificationQuestion ?? "Does this interpretation match what you intended?";
      clarificationQuestion.textContent = lastClarificationQuestion;
      calibrationResult.textContent = "Answer the question above if the interpretation needs clarification.";
      calibrateButton.disabled = false;
      exportButton.disabled = false;
    } catch (error) {
      analysisContainer.textContent = errorMessage(error, "Analysis failed.");
    } finally {
      analyzeButton.disabled = !selectedSegment();
    }
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
      calibrationResult.textContent = "Choose and analyze an utterance first.";
      return;
    }

    analyzeButton.disabled = true;
    calibrateButton.disabled = true;
    exportButton.disabled = true;
    calibrationResult.textContent = "Comparing the wording with the intended meaning…";

    try {
      const result = await requestAnalysis(request);
      lastResult = result;
      renderAnalysis(result);
      calibrationResult.textContent = `Intended meaning used for calibration: ${intendedMeaning}`;
      exportButton.disabled = false;
    } catch (error) {
      calibrationResult.textContent = errorMessage(error, "Calibration failed.");
    } finally {
      analyzeButton.disabled = !selectedSegment();
      calibrateButton.disabled = false;
    }
  });

  exportButton.addEventListener("click", () => {
    const segment = selectedSegment();
    if (!lastResult || !conversation || !segment) return;
    const analysis = lastResult.analysis?.find(item => item.segmentId === segment.id);
    const lines = [
      "# ConvoLens communication report",
      "",
      `Generated: ${new Date().toLocaleString()}`,
      `Focus speaker: ${getSpeakerLabel(conversation.userSpeakerId)}`,
      "",
      "## Selected utterance",
      "",
      segment.text,
      "",
      "## Analysis",
      "",
      ...(analysis ? [
        `- **Evidence:** ${analysis.evidence}`,
        `- **Likely conveyed meaning:** ${analysis.likelyConveyedMeaning}`,
        `- **Interpretation:** ${analysis.interpretation}`,
        `- **Clarification question:** ${lastClarificationQuestion || analysis.clarificationQuestion}`,
        ...(analysis.clarificationComparison
          ? [`- **Clarification comparison:** ${analysis.clarificationComparison}`]
          : []),
        `- **Refined formulation:** ${analysis.refinedFormulation}`
      ] : ["No structured model analysis was returned."]),
      ...(lastResult.clarification ? [
        "",
        "## Intended meaning",
        "",
        lastResult.clarification.userMeaning
      ] : []),
      "",
      "## Transcript",
      "",
      ...conversation.transcript.map(turn => `- **${getSpeakerLabel(turn.speakerId)}:** ${turn.text}`),
      "",
      `_${lastResult.disclaimer}_`
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `convolens-report-${new Date().toISOString().slice(0, 10)}.md`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
    exportStatus.textContent = "Report exported as a Markdown file.";
  });

  loadTranscription(
    demoTranscription,
    "Example transcript loaded. Choose a speaker to explore it, or add your own audio."
  );
}
