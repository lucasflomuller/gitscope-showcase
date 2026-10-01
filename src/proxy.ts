import { NextResponse, type NextRequest } from "next/server";

/** Demo-only guard. Normal mode remains a trusted, single-user local tool. */
export function proxy(request: NextRequest) {
  if (process.env.GITSCOPE_DEMO !== "1") return NextResponse.next();
  const path = request.nextUrl.pathname;
  if (/^\/api\/repos\/[^/]+\/prs$/.test(path)) {
    return NextResponse.json({ available: false, prs: {} });
  }
  const readPost = request.method === "POST" &&
    /^\/api\/repos\/[^/]+\/(symbols|references)$/.test(path);
  if (path === "/api/mcp" || (!['GET', 'HEAD'].includes(request.method) && !readPost)) {
    return NextResponse.json(
      { error: "The synthetic demo is read-only. Repository registration, review writes and AI calls are disabled." },
      { status: 403 },
    );
  }
  return NextResponse.next();
}

export const config = { matcher: "/api/:path*" };
