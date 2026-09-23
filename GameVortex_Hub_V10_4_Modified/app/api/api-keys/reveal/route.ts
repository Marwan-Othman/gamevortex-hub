import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { guardMutation } from "@/lib/api";

/*
 * Master Task Plan Section 3, item 2 — "تظهر تلقائيًا بعد الدفع".
 * The plaintext key is shown exactly once, then permanently cleared
 * from the database (only the hash remains) — same practice as
 * Stripe/GitHub API key creation screens.
 */
export async function GET(req: NextRequest) {
  const blocked = await guardMutation(
    req,
    "api-keys:reveal",
    20,
  );

  if (blocked) {
    return blocked;
  }

  try {
    const user = await requireUser();

    const purchaseId = req.nextUrl.searchParams.get(
      "purchaseId",
    );

    if (!purchaseId) {
      return NextResponse.json(
        { error: "PURCHASE_ID_REQUIRED" },
        { status: 400 },
      );
    }

    const purchase = await db.apiKeyPurchase.findUnique({
      where: { id: purchaseId },
      include: { apiKey: true },
    });

    if (
      !purchase ||
      purchase.userId !== user.id ||
      purchase.status !== "PAID" ||
      !purchase.apiKey
    ) {
      return NextResponse.json(
        { error: "NOT_FOUND" },
        { status: 404 },
      );
    }

    if (
      purchase.apiKey.revealedAt ||
      !purchase.apiKey.plainKeyOnce
    ) {
      return NextResponse.json(
        { error: "ALREADY_REVEALED" },
        { status: 409 },
      );
    }

    const plainKey = purchase.apiKey.plainKeyOnce;

    await db.apiKey.update({
      where: { id: purchase.apiKey.id },
      data: {
        plainKeyOnce: null,
        revealedAt: new Date(),
      },
    });

    return NextResponse.json({
      apiKey: plainKey,
      keyPrefix: purchase.apiKey.keyPrefix,
      warning:
        "احفظ هذا المفتاح الآن — لن يظهر مرة أخرى.",
    });
  } catch {
    return NextResponse.json(
      { error: "UNAUTHORIZED" },
      { status: 401 },
    );
  }
}
