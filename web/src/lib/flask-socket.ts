/**
 * Socket.IO do Flask via same-origin (Next rewrite `/flask/*` → api).
 * Evita `https://host:5000` em produção (TLS/Mixed Content) — causa de toast/badge atrasados.
 */
export type FlaskSocketConfig = {
  url: string;
  path: string;
};

export function getFlaskSocketConfig(): FlaskSocketConfig {
  const explicit = (process.env.NEXT_PUBLIC_FLASK_URL || "").trim().replace(/\/$/, "");
  if (typeof window === "undefined") {
    return { url: explicit || "http://127.0.0.1:5000", path: "/socket.io" };
  }
  if (explicit) {
    // Dev: aponta direto no Flask (path padrão).
    return { url: explicit, path: "/socket.io" };
  }
  // Produção / Next: `/flask/socket.io` → rewrite → `api:5000/socket.io`.
  return { url: window.location.origin, path: "/flask/socket.io" };
}

export function flaskSocketOptions(extra: Record<string, unknown> = {}) {
  const { path } = getFlaskSocketConfig();
  return {
    path,
    // Sem barra extra: `/flask/socket.io?EIO=4` casa o rewrite; `/socket.io/` 404/308.
    addTrailingSlash: false,
    // Só polling: o rewrite Next não faz upgrade WebSocket de forma confiável
    // ("WebSocket is closed before the connection is established").
    transports: ["polling"] as ("websocket" | "polling")[],
    upgrade: false,
    withCredentials: true,
    ...extra,
  };
}
