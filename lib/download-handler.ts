import { NextRequest, NextResponse } from "next/server";
import { guardRead, internalError, logRouteError } from "@/lib/api";
import { isDistributableStatus, resolveDownloadUrl } from "@/lib/downloads";

type DownloadRow = { id: string; downloadSource: string | null; sourceStatus: string } | null;

/**
 * Shared implementation of /download/game/[slug] and /download/app/[slug].
 * - rate limited, so the download counter cannot be inflated by a script
 * - HEAD requests (link previews, curl -I) are answered but never counted
 * - the redirect is a 303 with no-store, so browsers/CDNs cannot cache it and skip the counter
 */
export async function handleDownload(
  request: NextRequest,
  options: {
    scope: string;
    find: () => Promise<DownloadRow>;
    countDownload: (id: string) => Promise<unknown>;
  },
) {
  const blocked = await guardRead(request, options.scope, 60);
  if (blocked) return blocked;

  let item: DownloadRow;
  try {
    item = await options.find();
  } catch (error) {
    return internalError(options.scope, error, "DOWNLOAD_LOOKUP_FAILED");
  }
  const target = resolveDownloadUrl(item?.downloadSource);

  if (!item || !target) {
    return NextResponse.json({ success: false, error: "DOWNLOAD_NOT_AVAILABLE" }, { status: 404 });
  }
  if (!isDistributableStatus(item.sourceStatus)) {
    return NextResponse.json({ success: false, error: "DOWNLOAD_SOURCE_NOT_DISTRIBUTABLE" }, { status: 403 });
  }

  if (request.method !== "HEAD") {
    // A failed counter update must never block the download itself.
    await options.countDownload(item.id).catch((error: unknown) => {
      logRouteError(`${options.scope}:counter`, error);
    });
  }

  return NextResponse.redirect(target, {
    status: 303,
    headers: { "Cache-Control": "no-store, private" },
  });
}
