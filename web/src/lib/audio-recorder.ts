const RECORDER_MIME_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus",
  "audio/mp4",
];

export const AUDIO_RECORDING_MAX_MS = 10 * 60 * 1000;
const MIN_RECORDING_BYTES = 256;

export function isAudioRecordingSupported() {
  return (
    typeof window !== "undefined" &&
    typeof MediaRecorder !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia
  );
}

export function pickRecorderMime() {
  if (typeof MediaRecorder === "undefined") return "";
  return RECORDER_MIME_CANDIDATES.find((type) => MediaRecorder.isTypeSupported(type)) || "";
}

function extForMime(mime: string) {
  const type = mime.toLowerCase();
  if (type.includes("mp4")) return "m4a";
  if (type.includes("ogg")) return "ogg";
  return "weba";
}

export function recordedAudioFile(blob: Blob, mime: string): File | null {
  if (blob.size < MIN_RECORDING_BYTES) return null;
  const type = (mime || blob.type || "audio/webm").split(";")[0].trim() || "audio/webm";
  return new File([blob], `audio-record-site.${extForMime(type)}`, {
    type,
    lastModified: Date.now(),
  });
}

export function formatRecordingClock(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function audioRecorderErrorMessage(error: unknown) {
  const name = error && typeof error === "object" && "name" in error ? String(error.name) : "";
  if (name === "NotAllowedError" || name === "PermissionDeniedError") {
    return "Permita o uso do microfone para gravar o áudio.";
  }
  if (name === "NotFoundError" || name === "DevicesNotFoundError") {
    return "Nenhum microfone foi encontrado neste aparelho.";
  }
  if (name === "NotSupportedError") {
    return "Este navegador não permite gravar áudio.";
  }
  if (error instanceof Error && error.message.trim()) return error.message;
  return "Não foi possível gravar o áudio.";
}
