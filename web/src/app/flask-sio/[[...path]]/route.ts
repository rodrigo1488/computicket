import { NextRequest } from "next/server";
import { proxySocketIo } from "@/lib/socketio-proxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function flaskOrigin(): string {
  return (process.env.FLASK_URL || "http://127.0.0.1:5000").replace(/\/$/, "");
}

export function GET(request: NextRequest) {
  return proxySocketIo(request, flaskOrigin());
}

export function POST(request: NextRequest) {
  return proxySocketIo(request, flaskOrigin());
}

export function OPTIONS(request: NextRequest) {
  return proxySocketIo(request, flaskOrigin());
}
