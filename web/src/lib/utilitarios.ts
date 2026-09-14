import { flask } from "@/lib/api";

export type UtilityFile = {
  id: number;
  title: string;
  description: string;
  original_filename: string;
  file_size: number;
  file_size_label: string;
  file_type: string;
  download_count: number;
  created_at: string | null;
  download_url: string;
  created_by_name?: string;
};

export const UTILITY_MAX_FILE_BYTES = 1024 * 1024 * 1024;

type UploadInit = {
  upload_id: string;
  chunk_size: number;
  total_chunks: number;
};

async function putChunk(url: string, body: Blob, attempt = 0): Promise<void> {
  const res = await fetch(url, {
    method: "PUT",
    credentials: "include",
    headers: { Accept: "application/json", "Content-Type": "application/octet-stream" },
    body,
  });
  if (res.ok) return;
  const retryable = res.status === 524 || res.status === 502 || res.status === 503 || res.status === 504;
  if (retryable && attempt < 3) {
    await new Promise((resolve) => window.setTimeout(resolve, 600 * (attempt + 1)));
    return putChunk(url, body, attempt + 1);
  }
  let message = `Erro ${res.status}`;
  try {
    const data = (await res.json()) as { error?: string };
    if (data?.error) message = data.error;
  } catch {
    if (res.status === 524) message = "O envio passou do tempo limite da rede. Tente novamente.";
  }
  throw new Error(message);
}

export async function uploadUtilityFile(
  file: File,
  meta: { title?: string; description?: string },
  onProgress?: (percent: number) => void,
): Promise<UtilityFile> {
  if (file.size > UTILITY_MAX_FILE_BYTES) {
    throw new Error(`"${file.name}" passa de 1 GB. Envie um arquivo menor.`);
  }
  const started = await flask.post<UploadInit>("/utilitarios/api/uploads", {
    filename: file.name,
    size: file.size,
    mime: file.type,
    title: meta.title || "",
    description: meta.description || "",
  });
  const total = Math.max(1, started.total_chunks);
  const chunkSize = started.chunk_size;
  for (let index = 0; index < total; index += 1) {
    const blob = file.slice(index * chunkSize, Math.min(file.size, (index + 1) * chunkSize));
    await putChunk(`/flask/utilitarios/api/uploads/${started.upload_id}/chunks/${index}`, blob);
    onProgress?.(Math.round(((index + 1) / total) * 100));
  }
  return flask.post<UtilityFile>(`/utilitarios/api/uploads/${started.upload_id}/complete`);
}

export function utilityDownloadHref(file: Pick<UtilityFile, "id">) {
  return `/utilitarios/arquivo/${file.id}`;
}

export function formatUtilityDate(iso: string | null) {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}
