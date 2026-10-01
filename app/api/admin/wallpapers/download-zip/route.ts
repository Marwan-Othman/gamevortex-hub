import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getOptionalUser } from "@/lib/auth";
import { guardMutation } from "@/lib/api";
import { openWallpaperSource } from "@/lib/wallpaper-delivery";
import {
  WALLPAPER_BULK_DOWNLOAD_MAX,
  WALLPAPER_BULK_DOWNLOAD_MAX_BYTES,
} from "@/lib/wallpaper-constants";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function u16(v: number) {
  const b = new Uint8Array(2);
  new DataView(b.buffer).setUint16(0, v, true);
  return b;
}
function u32(v: number) {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, v >>> 0, true);
  return b;
}
function concat(...parts: Uint8Array[]) {
  const n = parts.reduce((a, b) => a + b.byteLength, 0);
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.byteLength;
  }
  return out;
}
function crc32Update(crc: number, data: Uint8Array) {
  let c = crc >>> 0;
  for (const byte of data) {
    c ^= byte;
    for (let k = 0; k < 8; k += 1) {
      c = (c >>> 1) ^ ((c & 1) ? 0xedb88320 : 0);
    }
  }
  return c >>> 0;
}
function crc32Final(crc: number) {
  return (crc ^ 0xffffffff) >>> 0;
}
function safeName(value: string, fallback: string) {
  const name = value
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 120);
  return name || fallback;
}

export async function POST(request: Request) {
  const guard = await guardMutation(request, "admin-wallpaper-zip", 10);
  if (guard) return guard;

  const user = await getOptionalUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role !== "SUPER_ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const body = (await request.json()) as { ids?: unknown };
    const ids = Array.from(
      new Set<string>(
        Array.isArray(body.ids)
          ? body.ids
              .filter((x): x is string => typeof x === "string")
              .map((x) => x.trim())
              .filter(Boolean)
          : [],
      ),
    ).slice(0, WALLPAPER_BULK_DOWNLOAD_MAX);

    if (!ids.length) {
      return NextResponse.json({ error: "No wallpapers selected" }, { status: 400 });
    }

    const rows = await prisma.wallpaper.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        imageUrl: true,
        mediaUrl: true,
        mediaType: true,
        originalFilename: true,
      },
      orderBy: { createdAt: "asc" },
    });

    if (!rows.length) {
      return NextResponse.json({ error: "No wallpapers found" }, { status: 404 });
    }

    const encoder = new TextEncoder();
    const central: Uint8Array[] = [];
    let offset = 0;
    let total = 0;
    let count = 0;

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          for (const row of rows) {
            const target =
              row.mediaType === "VIDEO" && row.mediaUrl
                ? row.mediaUrl
                : row.imageUrl;

            const opened = await openWallpaperSource(target);
            const fallback = `wallpaper-${row.id}`;
            const name = safeName(row.originalFilename || fallback, fallback);
            const nameBytes = encoder.encode(name);

            // ZIP data-descriptor mode lets us stream without buffering the whole file.
            const localHeader = concat(
              encoder.encode("PK\x03\x04"),
              u16(20),
              u16(0x0008),
              u16(0),
              u16(0),
              u16(0),
              u32(0),
              u32(0),
              u32(0),
              u16(nameBytes.length),
              u16(0),
              nameBytes,
            );

            controller.enqueue(localHeader);
            offset += localHeader.byteLength;

            let crc = 0xffffffff;
            let size = 0;
            const reader = opened.stream.getReader();

            try {
              while (true) {
                const part = await reader.read();
                if (part.done) break;
                const chunk = part.value;
                size += chunk.byteLength;
                total += chunk.byteLength;

                if (size > 50 * 1024 * 1024 || total > WALLPAPER_BULK_DOWNLOAD_MAX_BYTES) {
                  throw new Error("ZIP_SIZE_LIMIT");
                }

                crc = crc32Update(crc, chunk);
                controller.enqueue(chunk);
                offset += chunk.byteLength;
              }
            } finally {
              reader.releaseLock();
            }

            const finalCrc = crc32Final(crc);
            const descriptor = concat(
              encoder.encode("PK\x07\x08"),
              u32(finalCrc),
              u32(size),
              u32(size),
            );
            controller.enqueue(descriptor);
            offset += descriptor.byteLength;

            central.push(
              concat(
                encoder.encode("PK\x01\x02"),
                u16(20),
                u16(20),
                u16(0x0008),
                u16(0),
                u16(0),
                u16(0),
                u32(finalCrc),
                u32(size),
                u32(size),
                u16(nameBytes.length),
                u16(0),
                u16(0),
                u16(0),
                u16(0),
                u32(0),
                u32(offset - descriptor.byteLength - size - localHeader.byteLength),
                nameBytes,
              ),
            );

            count += 1;
          }

          const centralOffset = offset;
          for (const entry of central) {
            controller.enqueue(entry);
            offset += entry.byteLength;
          }

          const centralSize = offset - centralOffset;
          controller.enqueue(
            concat(
              encoder.encode("PK\x05\x06"),
              u16(0),
              u16(0),
              u16(count),
              u16(count),
              u32(centralSize),
              u32(centralOffset),
              u16(0),
            ),
          );

          await prisma.wallpaper.updateMany({
            where: { id: { in: rows.map((r) => r.id) } },
            data: { downloadCount: { increment: 1 } },
          });

          controller.close();
        } catch (error) {
          console.error("Wallpaper ZIP streaming error", error);
          controller.error(error);
        }
      },
    });

    return new Response(stream, {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": 'attachment; filename="gamevortex-wallpapers.zip"',
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    console.error("Wallpaper ZIP error", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to build ZIP" },
      { status: 400 },
    );
  }
}
