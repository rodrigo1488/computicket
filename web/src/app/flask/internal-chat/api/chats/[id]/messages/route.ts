import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const FLASK = process.env.FLASK_URL || "http://127.0.0.1:5000";
const MEDIA_TIMEOUT_MS = 120_000;
const TEXT_TIMEOUT_MS = 30_000;

const MEDIA_FAIL = "Não foi possível enviar o arquivo. Tente novamente.";
const MEDIA_TIMEOUT = "O envio do arquivo demorou demais. Tente um arquivo menor.";

function isMultipart(request: NextRequest): boolean {
  return (request.headers.get("content-type") || "").toLowerCase().includes("multipart/");
}

async function proxy(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const incoming = new URL(request.url);
  const target = `${FLASK.replace(/\/$/, "")}/internal-chat/api/chats/${id}/messages${incoming.search}`;
  const multipart = request.method === "POST" && isMultipart(request);
  const timeoutMs = multipart ? MEDIA_TIMEOUT_MS : TEXT_TIMEOUT_MS;

  const headers = new Headers();
  const cookie = request.headers.get("cookie");
  if (cookie) headers.set("cookie", cookie);
  const contentType = request.headers.get("content-type");
  if (contentType) headers.set("content-type", contentType);
  headers.set("accept", request.headers.get("accept") || "application/json");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const init: RequestInit & { duplex?: "half" } = {
    method: request.method,
    headers,
    cache: "no-store",
    redirect: "manual",
    signal: controller.signal,
  };
  if (request.method !== "GET" && request.method !== "HEAD") {
    init.body = request.body;
    init.duplex = "half";
  }

  try {
    const res = await fetch(target, init);
    const text = await res.text();
    let body = text;
    if (multipart && (!text || /^\s*</.test(text) || /^internal server error$/i.test(text.trim()))) {
      body = JSON.stringify({
        error: res.status >= 500 ? MEDIA_FAIL : "Não foi possível enviar o arquivo.",
      });
    }
    return new NextResponse(body, {
      status: res.status,
      headers: { "Content-Type": res.headers.get("content-type") || "application/json" },
    });
  } catch (error) {
    const timedOut =
      (error instanceof Error && error.name === "AbortError") ||
      (error instanceof Error && /timeout|aborted/i.test(error.message));
    return NextResponse.json(
      { error: multipart ? (timedOut ? MEDIA_TIMEOUT : MEDIA_FAIL) : "Não foi possível falar com o chat interno." },
      { status: timedOut ? 504 : 502 },
    );
  } finally {
    clearTimeout(timer);
  }
}

export function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  return proxy(request, context);
}

export function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  return proxy(request, context);
}
