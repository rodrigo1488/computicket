import { flask } from "@/lib/api";

export function publicBudgetUrl(token: string) {
  if (typeof window === "undefined") return `/orcamentos/publico/${token}`;
  return `${window.location.origin}/orcamentos/publico/${token}`;
}

export function tokenFromShareUrl(url?: string | null) {
  if (!url) return "";
  const m = url.match(/publico\/([^/?#]+)/i);
  return m?.[1] || "";
}

export async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    window.prompt("Copie o link público:", text);
    return false;
  }
}

export async function exportBudgetPdf(id: number) {
  await flask.download(`/orcamentos/${id}/pdf`);
}

export async function generateBudgetPublicLink(id: number, currentToken = "") {
  const res = await flask.post<{ success?: boolean; public_url?: string; error?: string }>(`/orcamentos/${id}/compartilhar`, {
    action: "generate",
  });
  if (res.success === false) throw new Error(res.error || "Não foi possível gerar o link público");
  const token = tokenFromShareUrl(res.public_url) || currentToken;
  if (!token) throw new Error("Não foi possível gerar o link público");
  await copyText(publicBudgetUrl(token));
  return token;
}

export async function revokeBudgetPublicLink(id: number) {
  await flask.post(`/orcamentos/${id}/compartilhar`, { action: "revoke" });
}
