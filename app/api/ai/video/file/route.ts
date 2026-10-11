import { NextRequest, NextResponse } from "next/server";
import { getOptionalUser } from "@/lib/auth";
import { guardRead } from "@/lib/api";
import { downloadFile } from "@/lib/ai/media";
import { readMediaToken } from "@/lib/ai/media-token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  // Browsers issue many Range requests while a <video> plays/seeks.
  const blocked = await guardRead(request, "ai:video-file", 240);
  if (blocked) return blocked;

  const user = await getOptionalUser();
  if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });

  const token = request.nextUrl.searchParams.get("token") || "";
  const data = readMediaToken(token);
  if (!data || data.kind !== "VIDEO" || data.sub !== user.id || !data.fileUri) {
    return NextResponse.json({ error: "INVALID_MEDIA_TOKEN" }, { status: 400 });
  }

  try {
    const result = await downloadFile(data.fileUri, request.signal, request.headers.get("range"));
    const headers: Record<string, string> = {
      "Content-Type": result.contentType,
      "Cache-Control": "private, no-store",
      "Accept-Ranges": "bytes",
      "X-Content-Type-Options": "nosniff",
    };
    if (result.contentLength) headers["Content-Length"] = result.contentLength;
    if (result.contentRange) headers["Content-Range"] = result.contentRange;
    return new NextResponse(result.body, { status: result.status, headers });
  } catch {
    return NextResponse.json({ error: "MEDIA_DOWNLOAD_FAILED" }, { status: 502 });
  }
}
