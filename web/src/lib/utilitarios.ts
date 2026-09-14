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
