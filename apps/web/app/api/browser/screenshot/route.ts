import { NextRequest, NextResponse } from "next/server";

const PLATFORM_API = process.env.PLATFORM_API_URL?.trim() || "http://localhost:3005";
const INTERNAL_TOKEN = process.env.PLATFORM_INTERNAL_TOKEN?.trim() || "dev-internal-token";

export async function GET(request: NextRequest) {
  const profile = request.nextUrl.searchParams.get("profile") || "openclaw";
  try {
    const res = await fetch(
      `${PLATFORM_API}/internal/browser/screenshot?profile=${encodeURIComponent(profile)}`,
      {
        headers: { Authorization: `Bearer ${INTERNAL_TOKEN}` },
        signal: AbortSignal.timeout(10_000),
        cache: "no-store",
      },
    );
    if (!res.ok) {
      return NextResponse.json({ error: "screenshot_failed", status: res.status }, { status: res.status });
    }
    const buf = await res.arrayBuffer();
    return new NextResponse(buf, {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return NextResponse.json({ error: "browser_unavailable", detail: String(err) }, { status: 503 });
  }
}
