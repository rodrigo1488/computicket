import path from "path";
import dotenv from "dotenv";
import { logger } from "./utils/logger";
import {
  getWhisperApiBasePath,
  isWhisperTranscriptionConfigured
} from "./config/openai";

const envFile = process.env.NODE_ENV === "test" ? ".env.test" : ".env";
const envPath = path.resolve(__dirname, "..", envFile);
dotenv.config({ path: envPath });

if (isWhisperTranscriptionConfigured()) {
  logger.info(
    { whisperBaseUrl: getWhisperApiBasePath() },
    "Transcrição de áudio: usando WHISPER_API_BASE_URL (serviço dedicado)"
  );
} else {
  logger.warn(
    "Transcrição de áudio: WHISPER_API_BASE_URL não definida ou vazia — requisições vão para LM_STUDIO_BASE_URL (normalmente 415). Defina WHISPER_API_BASE_URL no .env do backend."
  );
}

const shouldSuppressLibsignalNoise = (args: unknown[]): boolean => {
  const text = args
    .map(item => {
      if (typeof item === "string") return item;
      try {
        return JSON.stringify(item);
      } catch {
        return String(item);
      }
    })
    .join(" ");

  return (
    text.includes("Closing stale open session for new outgoing prekey bundle") ||
    text.includes("Closing session: SessionEntry") ||
    text.includes("Removing old closed session: SessionEntry")
  );
};

const installLibsignalLogFilter = () => {
  // Em produção, reduz ruído de logs internos do libsignal/Baileys.
  if (process.env.NODE_ENV !== "production") return;

  const originalConsoleLog = console.log.bind(console);
  const originalConsoleInfo = console.info.bind(console);

  console.log = (...args: unknown[]) => {
    if (shouldSuppressLibsignalNoise(args)) return;
    originalConsoleLog(...args);
  };

  console.info = (...args: unknown[]) => {
    if (shouldSuppressLibsignalNoise(args)) return;
    originalConsoleInfo(...args);
  };
};

installLibsignalLogFilter();
