# GameVortex AI Self-Hosted Migration

## Included in this bundle

- GameVortex AI provider abstraction for Chat, Image and Video remains enabled but defaults to external providers.
- Added `ai-server/` FastAPI gateway.
- Added server-side authentication.
- Added model registry and runtime adapters.
- Added OpenAI Responses-compatible `/responses` endpoint for the existing GameVortex Chat client.
- Added self-hosted Chat/Image/Video backend URL configuration.
- Added health and model status endpoints.
- Added Dockerfile and Python requirements for the gateway.
- Updated `.env.example` and `.env.production.example` with the new GameVortex AI variables.

## What is intentionally not completed

The actual GPU model weights and inference engines are not included in this ZIP.

The gateway is ready to connect to:
- an OpenAI-compatible self-hosted Chat backend,
- a self-hosted Image backend,
- an asynchronous self-hosted Video backend.

A real GPU server still needs to be provisioned and the selected open-source models installed and tested. Until then, the Next.js project must remain on its current external providers.

Do not set `GAMEVORTEX_AI_PROVIDER=GAMEVORTEX`, `GAMEVORTEX_IMAGE_PROVIDER=GAMEVORTEX`, or `GAMEVORTEX_VIDEO_PROVIDER=GAMEVORTEX` in production until the corresponding self-hosted backends have been deployed and verified.
