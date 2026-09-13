import express, { type ErrorRequestHandler } from "express";
import cors from "cors";
import multer, { MulterError } from "multer";
import { AnalysisError, analyzeStub, conversationSchema, type Analyzer } from "./calibration.js";
import { TranscriptionError, type Transcriber } from "./transcription.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, callback) => {
    if (file.mimetype.startsWith("audio/")) {
      callback(null, true);
      return;
    }
    callback(new TranscriptionError("INVALID_AUDIO", 400, "Upload a supported audio file."));
  }
});

export function createApp(
  analyze: Analyzer = analyzeStub,
  origin = process.env.FRONTEND_ORIGIN ?? "http://localhost:5173",
  transcribe?: Transcriber
) {
  const app = express();
  app.disable("x-powered-by");
  app.use(cors({ origin, methods: ["POST"], allowedHeaders: ["Content-Type"] }));
  app.use(express.json({ limit: "128kb" }));
  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });
  app.post("/api/calibration", async (req, res) => {
    if (!req.is("application/json")) {
      res.status(415).json({ error: { code: "UNSUPPORTED_MEDIA_TYPE", message: "Use Content-Type: application/json." } });
      return;
    }
    const parsed = conversationSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { code: "INVALID_INPUT", message: "Invalid conversation.", issues: parsed.error.issues.map(({ path, message }) => ({ path: path.join("."), message })) } });
      return;
    }
    res.json(await analyze(parsed.data));
  });
  app.post("/api/transcriptions", upload.single("audio"), async (req, res) => {
    if (!transcribe) {
      throw new TranscriptionError(
        "TRANSCRIPTION_NOT_CONFIGURED",
        503,
        "AssemblyAI transcription is not configured."
      );
    }
    if (!req.file) {
      throw new TranscriptionError("INVALID_AUDIO", 400, "Choose an audio file to upload.");
    }
    res.json(await transcribe({
      bytes: req.file.buffer,
      filename: req.file.originalname,
      mimeType: req.file.mimetype
    }));
  });
  app.use((_req, res) => {
    res.status(404).json({
      error: { code: "NOT_FOUND", message: "Use POST /api/calibration or POST /api/transcriptions." }
    });
  });
  const handleError: ErrorRequestHandler = (error, _req, res, _next) => {
    if (error instanceof AnalysisError) {
      res.status(error.status).json({ error: { code: error.code, message: error.message } });
      return;
    }
    if (error instanceof TranscriptionError) {
      res.status(error.status).json({ error: { code: error.code, message: error.message } });
      return;
    }
    if (error instanceof MulterError) {
      const tooLarge = error.code === "LIMIT_FILE_SIZE";
      res.status(tooLarge ? 413 : 400).json({ error: {
        code: tooLarge ? "AUDIO_TOO_LARGE" : "INVALID_AUDIO",
        message: tooLarge ? "Audio file must not exceed 25 MB." : "Invalid audio upload."
      } });
      return;
    }
    const status = error.type === "entity.too.large" ? 413 : error.type === "entity.parse.failed" ? 400 : error.status === 415 ? 415 : 500;
    res.status(status).json({ error: {
      code: status === 413 ? "PAYLOAD_TOO_LARGE" : status === 400 ? "INVALID_JSON" : status === 415 ? "UNSUPPORTED_ENCODING" : "ANALYSIS_FAILED",
      message: status === 413 ? "JSON body must not exceed 128 KB." : status === 400 ? "Send valid JSON." : status === 415 ? "Unsupported body encoding." : "Analysis could not be completed."
    } });
  };
  app.use(handleError);
  return app;
}
