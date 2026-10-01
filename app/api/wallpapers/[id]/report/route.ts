import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/prisma";
import { getOptionalUser } from "@/lib/auth";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getOptionalUser();
  if (!user) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  if (!id || id.length > 100) return NextResponse.json({ success: false, error: "Invalid wallpaper id" }, { status: 400 });

  try {
    const body = await request.json();
    const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 120) : "";
    const details = typeof body.details === "string" ? body.details.trim().slice(0, 1000) : null;
    if (!reason) return NextResponse.json({ success: false, error: "Reason is required" }, { status: 400 });
    const wallpaper = await db.wallpaper.findUnique({ where: { id }, select: { id: true, published: true } });
    if (!wallpaper || !wallpaper.published) return NextResponse.json({ success: false, error: "Wallpaper not found" }, { status: 404 });

    const existing = await db.wallpaperReport.findFirst({ where: { wallpaperId: id, reporterId: user.id, status: "PENDING" } });
    if (existing) return NextResponse.json({ success: false, error: "Already reported" }, { status: 409 });

    const report = await db.wallpaperReport.create({ data: { wallpaperId: id, reporterId: user.id, reason, details } });
    return NextResponse.json({ success: true, data: { id: report.id } }, { status: 201 });
  } catch {
    return NextResponse.json({ success: false, error: "Report failed" }, { status: 400 });
  }
}
