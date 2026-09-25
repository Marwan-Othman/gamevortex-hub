import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { guardRead } from "@/lib/api";
import { logSystemError } from "@/lib/observability";
import { requireUser } from "@/lib/auth";

// Lets the browser-side error boundary (app/error.tsx / app/global-error.tsx)
// report a crash so it lands in the same SystemError table admins already
// review at /admin/errors, instead of only existing in the visitor's own
// browser console where nobody will ever see it.
const schema = z.object({
  message: z.string().trim().min(1).max(500),
  digest: z.string().trim().max(100).optional(),
  path: z.string().trim().max(300).optional(),
});

export async function POST(request: NextRequest) {
  // This endpoint accepts no state-changing data (it only ever produces a
  // log row) and is called automatically by the client on crash, so a
  // read-style rate limit — without the same-origin CSRF requirement that
  // would reject legitimate same-page fetches in edge cases — is enough.
  const blocked = await guardRead(request, "client-error", 20);
  if (blocked) return blocked;

  let userId: string | undefined;
  try {
    const user = await requireUser();
    userId = user.id;
  } catch {
    // Anonymous visitors can still report crashes.
  }

  try {
    const body = schema.parse(await request.json());
    await logSystemError("client:crash", new Error(body.message), {
      userId,
      metadata: { digest: body.digest, path: body.path },
    });
  } catch {
    // Malformed report — nothing useful to log, and we never want this
    // endpoint itself to surface an error back to an already-crashed client.
  }

  return NextResponse.json({ ok: true });
}
