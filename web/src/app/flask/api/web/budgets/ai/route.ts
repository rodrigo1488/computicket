import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const FLASK = process.env.FLASK_URL || "http://127.0.0.1:5000";
const TIMEOUT_MS = 110_000;

async function proxy(request: NextRequest) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${FLASK}/api/web/budgets/ai`, {
      method: request.method,
      headers: {
        Accept: "application/json",
        "Content-Type": request.headers.get("content-type") || "application/json",
        cookie: request.headers.get("cookie") || "",
      },
      body: request.method === "GET" ? undefined : await request.text(),
      cache: "no-store",
      signal: controller.signal,
    });
    const text = await res.text();
    let body = text;
    if (!text || /^\s*</.test(text) || /^internal server error$/i.test(text.trim())) {
      body = JSON.stringify({
        success: false,
        error:
          res.status >= 500
            ? "A geração falhou no servidor. Tente novamente com uma descrição mais curta."
            : "Não foi possível gerar o orçamento.",
      });
    }
    return new NextResponse(body, {
      status: res.status,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    const timedOut =
      (error instanceof Error && error.name === "AbortError") ||
      (error instanceof Error && /timeout|aborted/i.test(error.message));
    return NextResponse.json(
      {
        success: false,
        error: timedOut
          ? "A geração demorou demais. Tente de novo com uma descrição mais objetiva."
          : "Não foi possível falar com a API de orçamentos. Tente novamente.",
      },
      { status: timedOut ? 504 : 502 },
    );
  } finally {
    clearTimeout(timer);
  }
}

export function GET(request: NextRequest) {
  return proxy(request);
}

export function POST(request: NextRequest) {
  return proxy(request);
}
