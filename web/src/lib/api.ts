export type PageRes<T> = {
  items: T[];
  total: number;
  page: number;
  per_page: number;
};

export type ColFilter = { field: string; op: "contains" | "equals"; value: string };

export function colFiltersParam(filters: ColFilter[]) {
  const active = filters.filter((f) => f.value.trim());
  if (!active.length) return "";
  return `&col_filters=${encodeURIComponent(JSON.stringify(active))}`;
}

export function asItems<T>(data: T[] | { items?: T[] } | null | undefined): T[] {
  if (!data) return [];
  if (Array.isArray(data)) return data;
  return data.items || [];
}

const _GENERIC_500 = /^internal server error$|^error 500$|^err_internal_server_error$/i;

function _isAiGenerationPath(path: string): boolean {
  return /\/budgets\/ai\b/.test(path) || /\/helpdesk\/api\/(?:conversations\/[^/]+\/)?ai\b/.test(path);
}

function _httpErrorMessage(
  status: number,
  data: unknown,
  ctx?: { path?: string; isFormData?: boolean },
): string {
  const path = ctx?.path || "";
  const payload = data as { error?: string; message?: string } | null;
  const raw = String(payload?.error || payload?.message || "").trim();
  const looksHtml = !raw || /^\s*</.test(raw);
  const generic500 = ctx?.isFormData
    ? "Não foi possível enviar o arquivo. Tente novamente; se persistir, envie um vídeo menor ou em MP4."
    : _isAiGenerationPath(path)
      ? "A geração falhou no servidor. Tente novamente; se persistir, descreva menos itens de uma vez."
      : "Erro interno no servidor. Tente novamente.";
  if (raw && !looksHtml) {
    if (_GENERIC_500.test(raw)) return generic500;
    return raw;
  }
  if (status === 404) return "Recurso não encontrado.";
  if (status === 500) return generic500;
  if (status === 413) return "Arquivo muito grande. O WhatsApp aceita no máximo 100 MB.";
  if (status === 502 || status === 503 || status === 504) {
    if (ctx?.isFormData) {
      return "Não foi possível enviar o arquivo. O WhatsApp pode estar lento; tente um vídeo menor ou em MP4.";
    }
    return "Serviço temporariamente indisponível. Tente novamente em instantes.";
  }
  return `Erro ${status}`;
}

export async function api<T = unknown>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  if (!headers.has("Accept")) headers.set("Accept", "application/json");
  if (init.body && !(init.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const res = await fetch(path, {
    ...init,
    headers,
    credentials: "include",
  });
  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { error: text };
    }
  }
  if (!res.ok) {
    throw new Error(
      _httpErrorMessage(res.status, data, {
        path,
        isFormData: init.body instanceof FormData,
      }),
    );
  }
  return data as T;
}

export const flask = {
  get: <T>(path: string) => api<T>(`/flask${path}`),
  post: <T>(path: string, body?: unknown) =>
    api<T>(`/flask${path}`, {
      method: "POST",
      body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
    }),
  patch: <T>(path: string, body?: unknown) =>
    api<T>(`/flask${path}`, { method: "PATCH", body: body ? JSON.stringify(body) : undefined }),
  put: <T>(path: string, body?: unknown) =>
    api<T>(`/flask${path}`, { method: "PUT", body: body ? JSON.stringify(body) : undefined }),
  delete: <T>(path: string) => api<T>(`/flask${path}`, { method: "DELETE" }),
  download: async (path: string) => {
    const res = await fetch(`/flask${path}`, { credentials: "include" });
    if (!res.ok) {
      let message = `Erro ${res.status}`;
      try {
        const data = await res.json();
        if (data?.error) message = data.error;
      } catch {
        /* ignore */
      }
      throw new Error(message);
    }
    const blob = await res.blob();
    const header = res.headers.get("content-disposition") || "";
    const star = header.match(/filename\*=UTF-8''([^;]+)/i);
    const plain = header.match(/filename="?([^";]+)"?/i);
    const raw = star?.[1] || plain?.[1] || path.split("/").pop() || "download";
    const name = decodeURIComponent(raw.replace(/['"]/g, "").trim());
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },
  open: async (path: string) => {
    const res = await fetch(`/flask${path}`, { credentials: "include" });
    if (!res.ok) {
      let message = `Erro ${res.status}`;
      try {
        const data = await res.json();
        if (data?.error) message = data.error;
      } catch {
        /* ignore */
      }
      throw new Error(message);
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const win = window.open(url, "_blank", "noopener");
    if (!win) {
      const a = document.createElement("a");
      a.href = url;
      a.download = path.split("/").pop() || "arquivo.pdf";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    }
  },
};
