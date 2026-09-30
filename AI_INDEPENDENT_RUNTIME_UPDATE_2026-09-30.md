# GameVortex AI Independent Runtime Update

Date: 2026-09-30

## What changed

- GameVortex AI chat remains powered by the self-hosted GameVortex AI runtime in `self-hosted-ai/`.
- The active application no longer references external media provider credentials or provider SDKs.
- `AiMediaProvider` now uses the internal marker `INTERNAL`.
- A migration was added to normalize existing `AiMediaJob.provider` values to `INTERNAL`.
- Media generation endpoints fail closed instead of pretending that the chat runtime can generate image/video files.
- Existing media records and Vercel Blob deletion support remain intact.
- `GAMEVORTEX_AI_RUNTIME_URL`, `GAMEVORTEX_AI_MODEL`, and `GAMEVORTEX_AI_RUNTIME_TOKEN` remain the server-side AI configuration.
- The sensitive-site protection in `lib/gamevortex-ai/runtime.ts` remains active.

## Important technical limitation

The self-hosted runtime included in this project exposes an Ollama-compatible `/api/chat` contract. That is a text/chat runtime. It does not expose an independent image/video generation API.

Therefore this build deliberately does **not** fake image/video generation. To make image/video generation real without adding an external provider, a separate self-hosted media runtime must be implemented later and connected through an internal GameVortex API contract.

## Deployment

For Vercel, `GAMEVORTEX_AI_RUNTIME_URL` must point to an HTTPS endpoint reachable from Vercel. `localhost` or a phone/computer local address cannot be reached by Vercel.

Required variables:

- `GAMEVORTEX_AI_RUNTIME_URL`
- `GAMEVORTEX_AI_MODEL`
- `GAMEVORTEX_AI_RUNTIME_TOKEN`
- `DATABASE_URL`
- `AUTH_SECRET`
- `BLOB_READ_WRITE_TOKEN` when Blob operations are needed

Do not place AI secrets in `NEXT_PUBLIC_*` variables.
