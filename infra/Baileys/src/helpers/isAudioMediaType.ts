export function isAudioMediaType(mediaType?: string | null): boolean {
  const t = (mediaType || "").toLowerCase().split(";")[0].trim();
  return (
    t === "audio" ||
    t === "ptt" ||
    t === "audiomessage" ||
    t === "voicemessage" ||
    t.startsWith("audio/") ||
    t.startsWith("ptt/")
  );
}
