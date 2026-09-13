# ConvoLens

ConvoLens is an AI communication coach. A user can upload or record a conversation, receive a speaker-labelled transcript, identify their speaker, explain what they intended to communicate, and receive evidence-grounded feedback with a clearer formulation.

## MVP flow

```text
Browser recording or audio upload
    -> Express API
    -> AssemblyAI transcription and diarization
    -> ConvoLens Conversation model
    -> speaker selection
    -> Groq communication analysis
    -> structured browser result
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
- Local audio stays in browser memory until **Transcribe audio** is selected.
- Uploaded audio is kept in backend memory and sent to AssemblyAI without local persistence.

See [DEPLOYMENT.md](./DEPLOYMENT.md) for the GitHub, Netlify, and Render deployment sequence. See [CHECKPOINT_MODEL_TO_CSS.md](./CHECKPOINT_MODEL_TO_CSS.md) for the implementation checkpoint.

## MVP limits

- Diarization currently expects two speakers.
- Audio uploads are limited to 25 MB.
- Render's free service may need time to wake after inactivity.
- There is no authentication, database, or saved conversation history.
