import { NextRequest } from "next/server";
import { proxySocketIo } from "@/lib/socketio-proxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function engineOrigin(): string {
  return (process.env.WHATSAPP_ENGINE_URL || "http://127.0.0.1:4000").replace(/\/$/, "");
}

export function GET(request: NextRequest) {
  return proxySocketIo(request, engineOrigin());
}

export function POST(request: NextRequest) {
  return proxySocketIo(request, engineOrigin());
}

export function OPTIONS(request: NextRequest) {
  return proxySocketIo(request, engineOrigin());
}
