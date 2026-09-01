import { NextRequest, NextResponse } from "next/server";

/**
 * Next trata path com `.io` como arquivo estático e devolve 404
 * (rewrites em beforeFiles não salvam em produção). Encaminha para
 * as rotas App Router `/flask-sio` e `/engine-sio`.
 */
export function middleware(request: NextRequest) {
  const url = request.nextUrl.clone();
  const { pathname } = url;

  if (pathname === "/flask/socket.io" || pathname.startsWith("/flask/socket.io/")) {
    url.pathname = pathname.replace(/^\/flask\/socket\.io/, "/flask-sio");
    return NextResponse.rewrite(url);
  }

  if (pathname === "/socket.io" || pathname.startsWith("/socket.io/")) {
    url.pathname = pathname.replace(/^\/socket\.io/, "/engine-sio");
    return NextResponse.rewrite(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/socket.io", "/socket.io/:path*", "/flask/socket.io", "/flask/socket.io/:path*"],
};
