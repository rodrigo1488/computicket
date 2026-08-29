/** Extrai mesaId e token de URL/path do QR da mesa (/mesa/:id?t=). */
export function parseMesaQrContent(raw: string): { mesaId: number; token: string } | null {
  const text = (raw || "").trim();
  if (!text) return null;

  let pathname = text;
  let search = "";

  try {
    if (/^https?:\/\//i.test(text)) {
      const url = new URL(text);
      pathname = url.pathname;
      search = url.search;
    } else if (text.includes("?")) {
      const qIndex = text.indexOf("?");
      pathname = text.slice(0, qIndex);
      search = text.slice(qIndex);
    }
  } catch {
    return null;
  }

  const match = pathname.match(/\/mesa\/(\d+)(?:\/cardapio)?\/?$/i);
  if (!match) return null;

  const mesaId = Number(match[1]);
  if (!Number.isFinite(mesaId) || mesaId <= 0) return null;

  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const token = params.get("t") || "";
  if (!token) return null;

  return { mesaId, token };
}
