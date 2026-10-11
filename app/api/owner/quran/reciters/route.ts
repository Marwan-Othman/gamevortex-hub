import { NextResponse } from 'next/server';
import { guardMutation, guardRead, ownerRouteError } from '../../../../../lib/api';
import { z } from 'zod';
import { Prisma, SourceStatus } from '@prisma/client';
import { db } from '../../../../../lib/prisma';
import { requireOwner } from '../../../../../lib/auth';

const url = z.string().url().refine((value) => value.startsWith('https://'), 'URL must use HTTPS');
const schema = z.object({
  nameAr: z.string().trim().min(2).max(120),
  nameEn: z.string().trim().min(2).max(120),
  riwayah: z.string().trim().max(80).optional().nullable(),
  style: z.string().trim().max(80).optional().nullable(),
  quality: z.string().trim().max(40).optional().nullable(),
  provider: z.string().trim().min(2).max(120),
  legalSourceUrl: url,
  licenseUrl: url.optional().nullable(),
  licenseStatus: z.string().trim().min(2).max(80),
  sourceVerificationStatus: z.nativeEnum(SourceStatus).default(SourceStatus.PENDING_REVIEW),
  audioBaseUrl: url,
  availableSurahs: z.array(z.number().int().min(1).max(114)).optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
  sortOrder: z.number().int().min(0).max(100000).default(0),
  active: z.boolean().default(false)
});

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function GET(request: Request) {
  const blocked = await guardRead(request, 'owner:quran:read', 60); if (blocked) return blocked;
  try {
    await requireOwner();
    const reciters = await db.quranReciter.findMany({ orderBy: [{ sortOrder: 'asc' }, { nameAr: 'asc' }] });
    return NextResponse.json(reciters);
  } catch (error) {
    return ownerRouteError(error, 'QURAN_LOAD_FAILED', 500);
  }
}

export async function POST(request: Request) {
  const blocked = await guardMutation(request, 'owner:quran', 30); if (blocked) return blocked;
  try {
    const owner = await requireOwner();
    const body = schema.parse(await request.json());
    if (body.active && body.sourceVerificationStatus !== SourceStatus.VERIFIED) return jsonError('ACTIVE_REQUIRES_VERIFIED_SOURCE');
    const verified = body.sourceVerificationStatus === SourceStatus.VERIFIED;
    const reciter = await db.quranReciter.create({
      data: {
        ...body,
        availableSurahs: body.availableSurahs ?? undefined,
        licenseUrl: body.licenseUrl ?? undefined,
        riwayah: body.riwayah ?? undefined,
        style: body.style ?? undefined,
        quality: body.quality ?? undefined,
        notes: body.notes ?? undefined,
        verificationDate: verified ? new Date() : undefined,
        verifiedBy: verified ? owner.id : undefined
      }
    });
    await db.auditLog.create({ data: { actorUserId: owner.id, action: 'QURAN_RECITER_CREATED', entityType: 'QuranReciter', entityId: reciter.id, metadata: { sourceVerificationStatus: reciter.sourceVerificationStatus, provider: reciter.provider } } });
    return NextResponse.json(reciter, { status: 201 });
  } catch (error) {
    return ownerRouteError(error, 'CREATE_FAILED', 500);
  }
}

export async function PATCH(request: Request) {
  const blocked = await guardMutation(request, 'owner:quran', 30); if (blocked) return blocked;
  try {
    const owner = await requireOwner();
    const payload = await request.json();
    const id = z.string().cuid().parse(payload.id);
    const body = schema.partial().parse(payload);
    delete (body as Record<string, unknown>).id;
    const { availableSurahs, ...updates } = body;
    const existing = await db.quranReciter.findUnique({ where: { id } });
    if (!existing) return jsonError('RECITER_NOT_FOUND',404);
    const nextStatus = body.sourceVerificationStatus ?? existing.sourceVerificationStatus;
    const nextActive = body.active ?? existing.active;
    if (nextActive && nextStatus !== SourceStatus.VERIFIED) return jsonError('ACTIVE_REQUIRES_VERIFIED_SOURCE');
    const verified = nextStatus === SourceStatus.VERIFIED;
    const reciter = await db.quranReciter.update({
      where: { id },
      data: {
        ...updates,
        ...(availableSurahs === undefined ? {} : { availableSurahs: availableSurahs ?? Prisma.JsonNull }),
        active: nextActive,
        verificationDate: verified ? (body.sourceVerificationStatus === SourceStatus.VERIFIED ? new Date() : existing.verificationDate) : null,
        verifiedBy: verified ? (body.sourceVerificationStatus === SourceStatus.VERIFIED ? owner.id : existing.verifiedBy) : null
      }
    });
    await db.auditLog.create({ data: { actorUserId: owner.id, action: 'QURAN_RECITER_UPDATED', entityType: 'QuranReciter', entityId: id, metadata: { changed: Object.keys(body) } } });
    return NextResponse.json(reciter);
  } catch (error) {
    return ownerRouteError(error, 'UPDATE_FAILED', 500);
  }
}

export async function DELETE(request: Request) {
  const blocked = await guardMutation(request, 'owner:quran', 30); if (blocked) return blocked;
  try {
    const owner = await requireOwner();
    const id = z.string().cuid().parse(new URL(request.url).searchParams.get('id'));
    await db.quranReciter.delete({ where: { id } });
    await db.auditLog.create({ data: { actorUserId: owner.id, action: 'QURAN_RECITER_DELETED', entityType: 'QuranReciter', entityId: id } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return ownerRouteError(error, 'DELETE_FAILED', 500);
  }
}
