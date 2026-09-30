# GameVortex AI - Voice + Media Update

This package contains the requested AI UI/architecture changes on top of the supplied `gamevortex-hub-main` project.

## Added

1. GameVortex-branded full-screen Voice Mode.
2. Persistent microphone button in the chat composer.
3. Browser speech recognition + speech synthesis when supported.
4. Arabic/English RTL/LTR support using the existing locale system.
5. Image and video generation buttons in the chat composer.
6. AI image/video results displayed directly under the conversation.
7. AI media history tied to the GameVortex AI conversation.
8. Media deletion from the conversation.
9. Vercel Blob persistence for generated media when `BLOB_READ_WRITE_TOKEN` is configured.
10. Owner (`SUPER_ADMIN`) bypass of GameVortex application-level AI media credits.
11. Server-side protected-route/secrets prompt guard.
12. Database migration linking `AiMediaJob` to `GameVortexAiConversation`.

## Owner policy

`SUPER_ADMIN` is treated as Owner VIP server-side. The new media route does not consume application-level image/video credits for the owner. This does not bypass provider billing, rate limits, infrastructure limits, or safety controls.

## Important provider note

The supplied repository contains `lib/ai-media/providers.ts`, but its external media provider/external video provider functions are intentionally fail-closed in this baseline. Therefore the package implements the UI, persistence, ownership, deletion, Blob storage, polling, and security layers without inventing unsupported provider behavior.

To make image/video generation actually execute, the provider implementation and server-side credentials must be enabled. Never expose `external media provider_KEY` or `external video provider_API_KEY` through `NEXT_PUBLIC_*` variables or Git.

## Database

Apply migration:

`prisma migrate deploy`

Migration:

`prisma/migrations/20260930070000_add_ai_media_conversation/migration.sql`

## Vercel Blob

The project should have the server-side `BLOB_READ_WRITE_TOKEN` connected to the Vercel Blob store. Generated media is stored under:

`ai-media/<userId>/<jobId>.*`
