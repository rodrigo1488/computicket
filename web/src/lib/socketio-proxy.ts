import { NextRequest } from "next/server";

const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailers",
  "transfer-encoding",
  "upgrade",
  "content-encoding",
  "content-length",
]);

function backendSocketIoUrl(backendOrigin: string, search: string): string {
  return `${backendOrigin.replace(/\/$/, "")}/socket.io${search}`;
}

export async function proxySocketIo(request: NextRequest, backendOrigin: string): Promise<Response> {
  const incoming = new URL(request.url);
  const target = backendSocketIoUrl(backendOrigin, incoming.search);
  const method = request.method.toUpperCase();

  const headers = new Headers();
  for (const key of ["cookie", "content-type", "accept"]) {
    const value = request.headers.get(key);
    if (value) headers.set(key, value);
  }

  const init: RequestInit = {
    method,
    headers,
    cache: "no-store",
    redirect: "manual",
  };
  if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS") {
    init.body = await request.arrayBuffer();
  }

  let upstream: Response;
  try {
    upstream = await fetch(target, init);
  } catch (error) {
    const message = error instanceof Error ? error.message : "falha no proxy Socket.IO";
    return new Response(message, { status: 502, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }

  const out = new Headers();
  upstream.headers.forEach((value, key) => {
    if (HOP_BY_HOP.has(key.toLowerCase())) return;
    if (key.toLowerCase() === "set-cookie") return;
    out.append(key, value);
  });
  const cookies =
    typeof upstream.headers.getSetCookie === "function" ? upstream.headers.getSetCookie() : [];
  for (const cookie of cookies) out.append("set-cookie", cookie);

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: out,
  });
}
