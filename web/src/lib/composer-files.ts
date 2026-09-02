const MIME_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/bmp": "bmp",
  "image/svg+xml": "svg",
  "image/heic": "heic",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
  "audio/mpeg": "mp3",
  "audio/ogg": "ogg",
  "audio/wav": "wav",
  "application/pdf": "pdf",
};

function extFor(file: File): string {
  const fromMime = MIME_EXT[(file.type || "").toLowerCase()];
  if (fromMime) return fromMime;
  const nameExt = file.name.includes(".") ? file.name.split(".").pop() : "";
  return (nameExt || "bin").toLowerCase();
}

function looksGenericName(name?: string) {
  const raw = (name || "").trim().toLowerCase();
  return !raw || raw === "blob" || raw === "image.png" || raw === "image.jpg" || raw === "untitled";
}

export function namedPastedFile(file: File): File {
  if (!looksGenericName(file.name)) return file;
  const ext = extFor(file);
  return new File([file], `colar-${Date.now()}.${ext}`, {
    type: file.type || "application/octet-stream",
    lastModified: file.lastModified || Date.now(),
  });
}

export function dataTransferHasFiles(dt?: DataTransfer | null) {
  if (!dt) return false;
  if (dt.files && dt.files.length > 0) return true;
  return Array.from(dt.types || []).some((type) => type === "Files");
}

export function filesFromDataTransfer(dt?: DataTransfer | null): File[] {
  if (!dt) return [];
  if (dt.files?.length) return Array.from(dt.files);
  const items = dt.items ? Array.from(dt.items) : [];
  return items
    .filter((item) => item.kind === "file")
    .map((item) => item.getAsFile())
    .filter((file): file is File => !!file);
}

export function filesFromClipboard(event: { clipboardData?: DataTransfer | null }): File[] {
  const dt = event.clipboardData;
  if (!dt) return [];
  const fromFiles = dt.files?.length ? Array.from(dt.files) : [];
  if (fromFiles.length) return fromFiles.map(namedPastedFile);
  const items = dt.items ? Array.from(dt.items) : [];
  return items
    .filter((item) => item.kind === "file")
    .map((item) => item.getAsFile())
    .filter((file): file is File => !!file)
    .map(namedPastedFile);
}
