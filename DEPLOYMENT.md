# ConvoLens deployment checklist

This follows the chosen deployment order: GitHub, Netlify frontend, Render backend, Netlify environment update, then an external-device test.

## 1. Push ConvoLens to GitHub

The repository must contain a commit before it can be pushed. Confirm that `backend/.env` is ignored and never commit provider keys.

```bash
git add .
git commit -m "Build ConvoLens MVP"
gh auth login -h github.com -p https -w
gh repo create ConvoLens --public --source=. --remote=origin --push
```

Use `--private` instead of `--public` if the source should remain private. Netlify and Render can connect to a private repository after GitHub access is granted.

## 2. Import the repository into Netlify

In Netlify:

1. Select **Add new project** and **Import an existing project**.
2. Choose GitHub and select the ConvoLens repository.
3. Confirm the build settings from `netlify.toml`:
   - Build command: `npm run build`
   - Publish directory: `dist`
4. Deploy the project.

The first frontend deployment can complete before the backend URL exists. Transcription and analysis will not work publicly until steps 4–6 are complete.

## 3. Save the Netlify frontend URL

Copy the production URL, for example:

```text
https://convolens-example.netlify.app
```

Do not include a trailing slash when using it as `FRONTEND_ORIGIN`.

## 4. Deploy the backend publicly on Render

In Render:

1. Select **New** and **Blueprint**.
2. Connect the same GitHub repository.
3. Render reads `render.yaml` and creates `convolens-api`.
4. Enter the three values marked for manual synchronization:
   - `FRONTEND_ORIGIN`: the exact Netlify production URL
   - `GROQ_API_KEY`: the Groq server key
   - `ASSEMBLYAI_API_KEY`: the AssemblyAI server key
5. Create the service and wait for the deploy to finish.

The blueprint uses:

```text
Build command: npm ci && npm run build:backend
Start command: npm run start:backend
Health check: /health
Host: 0.0.0.0
```

Verify the public backend URL:

```text
https://YOUR-RENDER-SERVICE.onrender.com/health
```

Expected response:

```json
{ "status": "ok" }
```

## 5. Set the frontend backend-URL variable

In Netlify, open the ConvoLens project environment-variable settings and add:

```text
Key: VITE_API_BASE_URL
Value: https://YOUR-RENDER-SERVICE.onrender.com
```

This URL is public configuration. Provider API keys must remain only in Render.

## 6. Redeploy Netlify

Trigger a new production deployment so Vite embeds `VITE_API_BASE_URL` into the frontend bundle.

Open the deployed site and confirm that browser requests use the Render hostname rather than `127.0.0.1`.

## 7. Test from a phone or another device

Use the Netlify HTTPS URL and test:

1. Open the site.
2. Select **Start recording** and allow microphone access.
3. Record a short conversation with two speakers.
4. Stop and preview the recording.
5. Select **Transcribe audio**.
6. Identify your speaker.
7. Enter your intended meaning and select **Analyze meaning**.
8. Confirm that the speaker-labelled transcript and Groq result appear.

If the first request is slow, open the Render `/health` URL and wait for the free service to wake, then retry.

## Deployment environment summary

### Netlify

```dotenv
VITE_API_BASE_URL=https://YOUR-RENDER-SERVICE.onrender.com
```

### Render

```dotenv
HOST=0.0.0.0
FRONTEND_ORIGIN=https://YOUR-NETLIFY-SITE.netlify.app
ANALYSIS_PROVIDER=groq
GROQ_MODEL=openai/gpt-oss-20b
GROQ_API_KEY=<secret>
ASSEMBLYAI_API_KEY=<secret>
```
