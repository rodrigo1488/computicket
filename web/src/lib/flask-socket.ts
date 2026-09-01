/**
 * Socket.IO do Flask via same-origin.
 * Evita `https://host:5000` em produção (TLS/Mixed Content) — causa de toast/badge atrasados.
 *
 * Path sem `.io`: o Next trata `/socket.io` como arquivo estático e devolve 404.
 * A rota App Router `/flask-sio` faz proxy para `api:5000/socket.io`.
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
  return { url: window.location.origin, path: "/flask-sio" };
}

export function flaskSocketOptions(extra: Record<string, unknown> = {}) {
  const { path } = getFlaskSocketConfig();
  return {
    path,
    addTrailingSlash: false,
    // Só polling: o proxy Next não faz upgrade WebSocket de forma confiável
    // ("WebSocket is closed before the connection is established").
    transports: ["polling"] as ("websocket" | "polling")[],
    upgrade: false,
    withCredentials: true,
    ...extra,
  };
}
