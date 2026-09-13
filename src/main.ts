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

type CalibrationRequest = Conversation & {
  calibration: {
    segmentId: string;
    userMeaning: string;
  };
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
  analysis?: {
    segmentId: string;
    evidence: string;
    likelyConveyedMeaning: string;
    interpretation: string;
    clarificationComparison: string | null;
    refinedFormulation: string;
  }[];
};

type ErrorResponse = {
  error?: {
    message?: string;
  };
};

const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:3001")
  .replace(/\/+$/u, "");

let conversation: Conversation | null = {
  userSpeakerId: "speaker_2",
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

const transcriptContainer = document.getElementById("transcript");
const audioFileInput = document.getElementById("audioFile");
const startRecordingButton = document.getElementById("startRecordingButton");
const stopRecordingButton = document.getElementById("stopRecordingButton");
const recordingStatus = document.getElementById("recordingStatus");
const recordingPreview = document.getElementById("recordingPreview");
const transcribeButton = document.getElementById("transcribeButton");
const transcriptionStatus = document.getElementById("transcriptionStatus");
const userSpeakerSelect = document.getElementById("userSpeaker");
const clarificationInput = document.getElementById("clarification");
const calibrateButton = document.getElementById("calibrateButton");
const analysisContainer = document.getElementById("analysis");
const calibrationResult = document.getElementById("calibrationResult");

function renderTranscript(transcript: TranscriptSegment[]) {
  if (!transcriptContainer) return;
  transcriptContainer.replaceChildren();
  for (const segment of transcript) {
    const paragraph = document.createElement("p");
    paragraph.textContent = `${segment.speakerId}: ${segment.text}`;
    transcriptContainer.appendChild(paragraph);
  }
}

renderTranscript(conversation.transcript);

if (
  audioFileInput instanceof HTMLInputElement &&
  startRecordingButton instanceof HTMLButtonElement &&
  stopRecordingButton instanceof HTMLButtonElement &&
  recordingStatus &&
  recordingPreview instanceof HTMLAudioElement &&
  transcribeButton instanceof HTMLButtonElement &&
  transcriptionStatus &&
  userSpeakerSelect instanceof HTMLSelectElement &&
  calibrateButton instanceof HTMLButtonElement &&
  analysisContainer &&
  calibrationResult
) {
  const recordingPreviewElement = recordingPreview;
  const calibrateButtonElement = calibrateButton;
  const transcriptionStatusElement = transcriptionStatus;
  const userSpeakerSelectElement = userSpeakerSelect;
  let transcription: TranscriptionResponse | null = null;
  let mediaRecorder: MediaRecorder | null = null;
  let mediaStream: MediaStream | null = null;
  let recordedFile: File | null = null;
  let recordingUrl: string | null = null;

  function stopMediaStream() {
    mediaStream?.getTracks().forEach(track => track.stop());
    mediaStream = null;
  }

  function clearRecording() {
    recordedFile = null;
    if (recordingUrl) URL.revokeObjectURL(recordingUrl);
    recordingUrl = null;
    recordingPreviewElement.pause();
    recordingPreviewElement.removeAttribute("src");
    recordingPreviewElement.load();
    recordingPreviewElement.hidden = true;
  }

  function resetTranscriptionSelection() {
    transcription = null;
    conversation = null;
    calibrateButtonElement.disabled = true;
    transcriptionStatusElement.textContent = "";
    userSpeakerSelectElement.replaceChildren();
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "Transcribe audio first";
    userSpeakerSelectElement.appendChild(option);
    userSpeakerSelectElement.disabled = true;
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
      resetTranscriptionSelection();
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
    resetTranscriptionSelection();
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
    transcriptionStatus.textContent = "Transcribing and identifying speakers…";

    try {
      const response = await fetch(`${apiBaseUrl}/api/transcriptions`, {
        method: "POST",
        body: formData
      });
      const result = await response.json() as TranscriptionResponse & ErrorResponse;
      if (!response.ok) {
        throw new Error(result.error?.message ?? "Transcription failed.");
      }

      transcription = result;
      conversation = null;
      renderTranscript(result.transcript);
      analysisContainer.textContent = "Choose which speaker is you, then submit a clarification.";
      calibrationResult.textContent = "";
      calibrateButton.disabled = true;

      userSpeakerSelect.replaceChildren();
      const placeholder = document.createElement("option");
      placeholder.value = "";
      placeholder.textContent = "Choose your speaker";
      userSpeakerSelect.appendChild(placeholder);
      for (const speaker of result.speakers) {
        const option = document.createElement("option");
        option.value = speaker.id;
        option.textContent = speaker.label;
        userSpeakerSelect.appendChild(option);
      }
      userSpeakerSelect.disabled = false;
      transcriptionStatus.textContent = `Transcription ready: ${result.transcript.length} speaker-labelled segments.`;
    } catch (error) {
      transcriptionStatus.textContent = error instanceof TypeError
        ? "Cannot reach the backend. Make sure npm run dev:backend is running."
        : error instanceof Error
          ? error.message
          : "Transcription failed.";
    } finally {
      transcribeButton.disabled = false;
      startRecordingButton.disabled = false;
      audioFileInput.disabled = false;
    }
  });

  userSpeakerSelect.addEventListener("change", () => {
    if (!transcription || !userSpeakerSelect.value) {
      conversation = null;
      calibrateButton.disabled = true;
      return;
    }

    conversation = {
      userSpeakerId: userSpeakerSelect.value,
      participants: transcription.participants,
      transcript: transcription.transcript
    };
    calibrateButton.disabled = false;
    transcriptionStatus.textContent = `${userSpeakerSelect.selectedOptions[0]?.textContent ?? "Speaker"} selected as you.`;
  });
}

if (
  clarificationInput instanceof HTMLInputElement &&
  calibrateButton instanceof HTMLButtonElement &&
  analysisContainer &&
  calibrationResult
) {
  calibrateButton.addEventListener("click", async () => {
    if (!conversation) {
      calibrationResult.textContent = "Choose which speaker is you first.";
      return;
    }
    const targetSegment = [...conversation.transcript]
      .reverse()
      .find(segment => segment.speakerId === conversation?.userSpeakerId);
    if (!targetSegment) {
      calibrationResult.textContent = "No transcript segment belongs to the selected speaker.";
      return;
    }
    const request: CalibrationRequest = {
      ...conversation,
      calibration: {
        segmentId: targetSegment.id,
        userMeaning: clarificationInput.value
      }
    };

    calibrateButton.disabled = true;
    calibrationResult.textContent = "Analyzing…";

    try {
      const response = await fetch(`${apiBaseUrl}/api/calibration`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request)
      });
      const result = await response.json() as CalibrationResponse & ErrorResponse;

      if (!response.ok) {
        throw new Error(result.error?.message ?? "Calibration failed.");
      }

      const modelAnalysis = result.analysis?.[0];
      if (modelAnalysis) {
        analysisContainer.replaceChildren();
        for (const [label, value] of [
          ["Evidence", modelAnalysis.evidence],
          ["Likely conveyed meaning", modelAnalysis.likelyConveyedMeaning],
          ["Interpretation", modelAnalysis.interpretation],
          ["Clarification comparison", modelAnalysis.clarificationComparison],
          ["Refined formulation", modelAnalysis.refinedFormulation]
        ]) {
          if (value) {
            const paragraph = document.createElement("p");
            paragraph.textContent = `${label}: ${value}`;
            analysisContainer.appendChild(paragraph);
          }
        }
      } else {
        const phrases = result.observations
          .flatMap(observation => observation.tentativePhrases)
          .join(", ");
        analysisContainer.textContent = phrases
          ? `Tentative phrasing found: ${phrases}.`
          : "No tentative phrasing was found.";
      }
      calibrationResult.textContent = result.clarification
        ? `Your intended meaning: ${result.clarification.userMeaning}`
        : result.disclaimer;
    } catch (error) {
      calibrationResult.textContent = error instanceof TypeError
        ? "Cannot reach the backend. Make sure npm run dev:backend is running."
        : error instanceof Error
          ? error.message
          : "Calibration failed.";
    } finally {
      calibrateButton.disabled = false;
    }
  });
}
