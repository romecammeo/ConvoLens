# ConvoLens

ConvoLens is an AI communication coach. A user can upload or record a conversation, receive a speaker-labelled transcript, choose a focus speaker, review communication gaps suggested by ConvoLens, clarify their actual intention, and export a context-aware clearer formulation.

## MVP flow

```text
Browser recording, audio upload, or Markdown transcript
    -> Express API
    -> AssemblyAI diarization for audio / local parser for Markdown
    -> ConvoLens Conversation model
    -> focus-speaker selection
    -> Groq identifies 1-4 parts worth reviewing
    -> user selects a suggested part or another turn
    -> Groq explains what the wording likely conveyed
    -> user answers a contextual clarification question
    -> Groq uses the turn + surrounding context + intended meaning
    -> clearer formulation, learning explanation, and Markdown export
```

## Stack

- Frontend: HTML, CSS, TypeScript, and Vite
- Backend: Node.js, Express, TypeScript, and Zod
- Analysis: Groq using `openai/gpt-oss-20b`
- Transcription and speaker diarization: AssemblyAI
- Frontend hosting: Netlify
- Backend hosting: Render

## Local setup

Install dependencies:

```bash
npm install
```

Create `backend/.env` from `backend/.env.example` and add your server-side provider keys:

```dotenv
PORT=3001
HOST=127.0.0.1
FRONTEND_ORIGIN=http://localhost:5173
ANALYSIS_PROVIDER=auto
GROQ_API_KEY=<your-key>
GROQ_MODEL=openai/gpt-oss-20b
ASSEMBLYAI_API_KEY=<your-key>
```

Start the backend:

```bash
npm run dev:backend
```

Start the frontend in another terminal:

```bash
npm run dev -- --host localhost --port 5173 --strictPort
```

Open `http://localhost:5173`.

## Markdown transcript format

Use one speaker-labelled turn per line. Plain and Markdown-list forms are accepted:

```markdown
Speaker A: What exactly are you proposing?
Speaker B: I think we should revisit the earlier approach.
```

```markdown
- **Alice:** What exactly are you proposing?
- **Bob:** I think we should revisit the earlier approach.
```

If the file contains a `## Transcript` or `## Full transcript` heading, only the labelled lines in that section are imported. Markdown transcripts are parsed locally by the backend and do not use AssemblyAI.

## Checks

```bash
npm run typecheck:frontend
npm run typecheck:backend
npm run test:backend
npm run build
npm run build:backend
```

## Environment boundaries

- `GROQ_API_KEY` and `ASSEMBLYAI_API_KEY` exist only on the backend.
- `VITE_API_BASE_URL` is a public frontend setting containing the deployed backend URL.
- A local recording stays in browser memory until **Create transcript** is selected.
- Uploaded audio is kept in backend memory and sent to AssemblyAI without local persistence.
- Uploaded Markdown is parsed in backend memory and is not sent to AssemblyAI.
- `POST /api/review-candidates` reduces the transcript-search burden by returning validated focus-speaker segment IDs.
- `POST /api/calibration` keeps the richer analysis contract while the browser presents only evidence, conveyed meaning, clarification, refinement, and a learning explanation.

See [DEPLOYMENT.md](./DEPLOYMENT.md) for the GitHub, Netlify, and Render deployment sequence. See [CHECKPOINT_MODEL_TO_CSS.md](./CHECKPOINT_MODEL_TO_CSS.md) for the implementation checkpoint.

## MVP limits

- Diarization currently expects two speakers.
- Audio and Markdown uploads are limited to 25 MB.
- Render's free service may need time to wake after inactivity.
- There is no authentication, database, or saved conversation history.
- Candidate discovery currently selects individual speaker turns. A later version can allow a multi-turn conversational span without changing the transcript model.
- Candidate discovery has a deterministic local fallback when Groq is not configured; the user can always choose a different turn.
