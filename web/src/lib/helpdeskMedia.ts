const IMAGE_EXT = new Set(["jpg", "jpeg", "png", "gif", "webp", "bmp", "svg", "heic", "heif"]);
const AUDIO_EXT = new Set(["mp3", "ogg", "oga", "opus", "wav", "m4a", "aac", "weba", "caf", "flac", "amr"]);
const VIDEO_EXT = new Set(["mp4", "webm", "mov", "m4v", "3gp", "3gpp", "mkv", "avi"]);

export type ThreadMediaKind = "image" | "audio" | "video" | "file";

export function mediaExt(url?: string | null) {
  const path = (url || "").split(/[?#]/)[0];
  const base = path.split("/").pop() || "";
  const dot = base.lastIndexOf(".");
  return dot >= 0 ? base.slice(dot + 1).toLowerCase() : "";
}

export function mediaKind(mediaType?: string | null, mediaUrl?: string | null): ThreadMediaKind {
  const raw = (mediaType || "").toLowerCase().split(";")[0].trim();
  const type = raw.replace(/message$/, "");
  const ext = mediaExt(mediaUrl);
  if (type === "ptt" || type.startsWith("ptt/") || type.startsWith("audio") || AUDIO_EXT.has(ext)) return "audio";
  if (type.startsWith("video") || VIDEO_EXT.has(ext)) return "video";
  if (type === "sticker" || type.startsWith("image") || IMAGE_EXT.has(ext)) return "image";
  return "file";
}

export function isInlinePlayableMedia(mediaType?: string | null, mediaUrl?: string | null) {
  return mediaKind(mediaType, mediaUrl) !== "file";
}

export function isPlaceholderAudioBody(body?: string | null) {
  const t = (body || "").trim().toLowerCase();
  return !t || t === "-" || t === "áudio" || t === "audio";
}
