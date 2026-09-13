# ConvoLens checkpoint: model setup through CSS integration

**Checkpoint date:** September 12, 2026
**Repository:** `/Users/Rome/Documents/Repositories/ConvoLens`

## Current result

ConvoLens now has a working MVP pipeline:

```text
Audio upload
    -> Express backend
    -> AssemblyAI transcription and speaker diarization
    -> ConvoLens Conversation object
    -> user identifies their speaker
    -> Groq communication analysis
    -> structured response
    -> browser rendering
```

The application still starts with a small sample conversation so the analysis flow can be demonstrated without uploading audio. Uploading a recording replaces that sample for the active browser session.

## 1. Initial backend and stable contract

The first backend was intentionally small:

- Node.js, Express, and TypeScript.
- `POST /api/calibration` as the stable analysis endpoint.
- Zod validation at the HTTP boundary.
- A deterministic analyzer for development before enabling an external model.
- Dependency injection through the `Analyzer` function type, allowing Groq to replace the stub without changing the route.
- Local CORS access from `http://localhost:5173`.
- JSON body limit of 128 KB.
- Safe client-facing errors that do not return provider internals.

The internal data model remained:

```ts
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
```

Calibration extends the conversation with:

```ts
calibration: {
  segmentId: string;
  userMeaning: string;
}
```

Validation confirms that participants and segment IDs are valid and unique, transcript speakers are known participants, the selected user has at least one segment, and the calibration segment belongs to that user.

## 2. Frontend to backend calibration loop

The frontend-only calibration echo was replaced with a real HTTP request:

```ts
fetch("http://127.0.0.1:3001/api/calibration", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(request)
});
```

The browser now:

1. Reads the clarification input.
2. Chooses the last transcript segment belonging to `userSpeakerId`.
3. Builds the existing conversation plus calibration payload.
4. Sends JSON to Express.
5. Parses the JSON response.
6. Renders analysis fields or the deterministic fallback result.
7. Displays minimal loading, validation, provider, and network-error states.

The loop was checked with valid input, invalid input, changed conversation content, and an unavailable backend. No frontend source contains an API key.

## 3. Groq communication-analysis model

### Configuration

Groq is configured only in `backend/.env`:

```dotenv
ANALYSIS_PROVIDER=auto
GROQ_API_KEY=<server-side key>
GROQ_MODEL=openai/gpt-oss-20b
```

`ANALYSIS_PROVIDER` supports:

- `auto`: use Groq when its key exists; otherwise use the deterministic stub.
- `groq`: require the key and use Groq.
- `stub`: force deterministic local behavior.

The key is not placed in `src/main.ts`, `index.html`, or a `VITE_*` variable. `.gitignore` ignores `backend/.env` through the `.env` rule while preserving `.env.example`.

### Adapter behavior

`backend/src/groq.ts` owns all Groq-specific code. It uses `openai/gpt-oss-20b` and requests strict JSON-schema output.

The model receives:

- the full transcript;
- the user's speaker ID;
- explicit target segment IDs;
- the optional user clarification.

The system instruction asks the model to focus on articulation, distinguish evidence from interpretation, avoid claims about private mental states, compare conveyed and intended meaning, and produce a clearer formulation.

Each analysis item contains:

```ts
{
  segmentId: string;
  evidence: string;
  likelyConveyedMeaning: string;
  interpretation: string;
  clarificationComparison: string | null;
  refinedFormulation: string;
}
```

The backend validates the response again after Groq returns it. Returned IDs must exactly match the requested target IDs, and every evidence string must occur in the corresponding transcript segment. Harmless surrounding quotation marks and whitespace differences are normalized before checking evidence.

Provider failures are mapped to stable errors for timeout, rate limit, unavailable provider, and invalid structured output.

### Live Groq check

A fictional transcript was sent through the adapter. The structured result referenced `segment_0004` and returned:

```json
{
  "segmentId": "segment_0004",
  "evidence": "Maybe we could test a smaller version first.",
  "likelyConveyedMeaning": "The speaker intends to test a smaller version before committing.",
  "interpretation": "The speaker is proposing a preliminary test of a smaller version of the project.",
  "clarificationComparison": "Consistent with user clarification",
  "refinedFormulation": "I propose we test a smaller version first before committing."
}
```

No personal conversation was used for this provider check.

## 4. AssemblyAI transcription and diarization

### Configuration

AssemblyAI uses a separate server-side key:

```dotenv
ASSEMBLYAI_API_KEY=<server-side key>
```

It is configured in `backend/src/assemblyai.ts` with:

```ts
speech_models: ["universal-3-pro", "universal-2"],
language_detection: true,
speaker_labels: true,
speakers_expected: 2
```

Universal-3 Pro is preferred and Universal-2 is the fallback. Speaker diarization is a transcription option rather than a third independent model that requires another key.

### Upload endpoint

The new endpoint is:

```text
POST http://127.0.0.1:3001/api/transcriptions
Content-Type: multipart/form-data
Field name: audio
```

The browser uses `FormData` and does not manually set the multipart boundary:

```ts
const formData = new FormData();
formData.append("audio", file);

await fetch("http://127.0.0.1:3001/api/transcriptions", {
  method: "POST",
  body: formData
});
```

Multer keeps the upload in memory. ConvoLens does not save it to disk. The current upload limit is 25 MB, and files must have an `audio/*` MIME type.

### Provider adapter

`backend/src/transcription.ts` prevents AssemblyAI-specific fields from spreading through the app. It validates the provider response and transforms it into the ConvoLens model:

- Provider speakers are normalized in first-seen order to `speaker_1`, `speaker_2`, and so on.
- Display names remain `Speaker A`, `Speaker B`, and so on.
- Segments receive stable IDs such as `segment_0001`.
- Empty utterances and invalid provider results are rejected.

A live two-speaker synthetic recording produced:

```json
{
  "audioDurationSeconds": 10,
  "speakers": [
    { "id": "speaker_1", "label": "Speaker A" },
    { "id": "speaker_2", "label": "Speaker B" }
  ],
  "participants": ["speaker_1", "speaker_2"],
  "transcript": [
    {
      "id": "segment_0001",
      "speakerId": "speaker_1",
      "text": "Good morning, what would you like to discuss today?"
    },
    {
      "id": "segment_0002",
      "speakerId": "speaker_2",
      "text": "I want to propose a different approach to the project."
    },
    {
      "id": "segment_0003",
      "speakerId": "speaker_1",
      "text": "What change are you suggesting?"
    },
    {
      "id": "segment_0004",
      "speakerId": "speaker_2",
      "text": "Maybe we could test a smaller version first."
    }
  ]
}
```

Both the direct AssemblyAI adapter and the Express multipart endpoint returned the expected two-speaker result.

## 5. Speaker selection and full pipeline handoff

After transcription, the frontend:

1. Renders the returned speaker-labelled segments.
2. Populates the **Which speaker are you?** selector.
3. Waits for the user to choose their speaker.
4. Creates a provider-independent `Conversation` object.
5. Enables calibration.
6. Selects the user's last segment as the calibration target.
7. Sends the conversation and clarification to the unchanged Groq endpoint.

This establishes the intended boundary:

```text
AssemblyAI response
    -> transcription adapter
    -> Conversation
    -> analysis endpoint
    -> Groq adapter
    -> structured analysis
    -> frontend
```

## 6. CSS directions and selected design

Three MVP directions were considered:

| Direction | Character | Hackathon tradeoff |
|---|---|---|
| Demo Dashboard | Dark, polished, numbered workflow and strong calls to action | Best immediate explanation of the product during a short demo |
| Calm Coach | Light, friendly and understated | Approachable, but less visually distinct on a projector |
| Minimal Prototype | Nearly unstyled, utilitarian controls | Fastest, but looks unfinished beside the working AI pipeline |

The **Demo Dashboard** direction was selected and implemented in `src/style.css`.

The final interface includes:

- a concise product hero;
- four numbered workflow panels;
- a two-column desktop grid and one-column mobile layout below 760 px;
- styled file, select, text, button, result, loading, and disabled states;
- visible keyboard focus treatment;
- `prefers-reduced-motion` support;
- no CSS framework or runtime dependency.

Browser inspection at 1280 x 720 confirmed that the stylesheet loaded, the workflow rendered in two columns, and the page had no horizontal overflow. The production build also passed.

## 7. Files added or changed during this checkpoint

### Backend source

- `backend/src/calibration.ts` — request schema, response schema, stub, shared analyzer boundary, safe analysis errors.
- `backend/src/app.ts` — Express routes, CORS, JSON parsing, multipart handling, limits, and safe errors.
- `backend/src/server.ts` — environment selection and local server startup.
- `backend/src/groq.ts` — Groq adapter, structured output, grounding validation, and provider error mapping.
- `backend/src/assemblyai.ts` — AssemblyAI client and diarization configuration.
- `backend/src/transcription.ts` — provider-response validation and internal transcript adapter.

### Tests and configuration

- `backend/tests/http.test.ts` — calibration route and HTTP-boundary behavior.
- `backend/tests/groq.test.ts` — prompt construction, structured validation, evidence grounding, and error mapping.
- `backend/tests/transcription.test.ts` — adapter, multipart upload, limits, missing configuration, and provider failures.
- `backend/tsconfig.json` — strict backend TypeScript build.
- `backend/.env.example` — safe configuration template without secrets.
- `.gitignore` — environment files, build output, logs, and dependencies.
- `package.json` and `package-lock.json` — dependencies and runnable scripts.

### Frontend

- `src/main.ts` — calibration request, response rendering, audio upload, transcript rendering, speaker selection, loading, and errors.
- `src/style.css` — selected hackathon design.
- `index.html` — workflow structure, stylesheet link, copy, controls, and live status regions.

### Documentation

- `BACKEND_SETUP.md` — original backend checkpoint; it predates the later integrations.
- `BACKEND_COMMAND_LOG.md` — original backend command history.
- `CHECKPOINT_MODEL_TO_CSS.md` — this current checkpoint.

## 8. Dependencies added

Runtime:

```text
assemblyai
cors
express
groq-sdk
multer
zod
```

Development:

```text
@types/cors
@types/express
@types/multer
@types/node
tsx
typescript
vite
```

## 9. Core commands executed

Dependency installation:

```bash
npm install express cors zod
npm install --save-dev @types/express @types/cors @types/node tsx
npm install groq-sdk
npm install assemblyai multer
npm install --save-dev @types/multer
```

Development servers:

```bash
npm run dev:backend
npm run dev -- --host localhost --port 5173 --strictPort
```

Checks and builds:

```bash
npm run typecheck:backend
npx tsc --noEmit --target ES2022 --module ESNext --moduleResolution bundler --skipLibCheck src/main.ts
npm run test:backend
npm run build:backend
npx vite build
```

The multipart endpoint was also smoke-tested with the equivalent of:

```bash
curl -F "audio=@two-speaker-test.wav;type=audio/wav" \
  http://127.0.0.1:3001/api/transcriptions
```

A plain browser visit to an API URL performs `GET`, so this response is expected:

```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "Use POST /api/calibration or POST /api/transcriptions."
  }
}
```

The frontend performs the required `POST` requests.

## 10. Verification status

| Check | Result |
|---|---|
| Backend TypeScript | Passed |
| Frontend TypeScript | Passed |
| Backend production build | Passed |
| Frontend Vite build | Passed |
| Backend automated tests | 40 passed, 0 failed |
| Deterministic browser/backend loop | Passed |
| Groq synthetic live check | Passed |
| AssemblyAI synthetic live check | Passed |
| Express multipart transcription check | Passed |
| CSS loaded in browser | Passed |
| Desktop layout and overflow inspection | Passed |
| Real user recording through the browser file picker | Remaining manual acceptance test |

## 11. How to run the checkpoint

From the repository, start the backend:

```bash
npm run dev:backend
```

In another terminal, start the frontend:

```bash
npm run dev -- --host localhost --port 5173 --strictPort
```

Open `http://localhost:5173/`, then:

1. Choose a short two-speaker audio file.
2. Select **Transcribe audio**.
3. Select which detected speaker is you.
4. Enter what you intended to communicate.
5. Select **Analyze meaning**.
6. Review the evidence, conveyed meaning, comparison, and refined formulation.

## 12. Architectural decisions

- Keep one internal `Conversation` model across the whole application.
- Isolate each external provider behind an adapter.
- Validate browser input and external model output at runtime.
- Keep the deterministic analyzer as a development fallback.
- Keep all provider credentials on the backend.
- Bind the development backend to `127.0.0.1`.
- Keep audio in memory and avoid persistence for the MVP.
- Use explicit speaker selection because diarization identifies voices but cannot know which voice belongs to the current user.
- Preserve the original endpoint contract when replacing the stub with Groq.
- Use plain HTML, TypeScript, and CSS without React or a CSS framework.
- Avoid authentication, database storage, accounts, history, and production infrastructure during the hackathon slice.å

## 13. Known limits and next steps

- Diarization currently hints that two speakers are expected.
- The MVP accepts uploaded audio; browser microphone recording is not implemented.
- Uploaded audio must be no larger than 25 MB.
- Conversations and results are not persisted.
- The frontend currently selects the user's last transcript segment for calibration rather than letting the user choose any segment.
- A real user recording should be tested manually through the browser before the demo.
- `README.md` still describes the earliest project state and should eventually be updated from this checkpoint.
- The repository currently reports all project files as untracked; no checkpoint commit has been created.

The next sensible milestone is a short manual demo rehearsal using a real two-speaker recording, followed by fixing only issues that appear in that flow.
