import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/prisma";
import { requireOwner } from "@/lib/auth";
import { guardMutation } from "@/lib/api";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const blocked = await guardMutation(
    req,
    "owner:api-keys:revoke",
    10,
  );

  if (blocked) {
    return blocked;
  }

  try {
    await requireOwner();

    const { id } = await params;

    const apiKey = await db.apiKey.update({
      where: { id },
      data: {
        status: "REVOKED",
        revokedAt: new Date(),
      },
    });

    return NextResponse.json({
      id: apiKey.id,
      status: apiKey.status,
    });
  } catch {
    return NextResponse.json(
      { error: "REVOKE_FAILED" },
      { status: 400 },
    );
  }
}
