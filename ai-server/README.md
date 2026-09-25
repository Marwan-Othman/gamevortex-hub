# GameVortex AI Server

Private FastAPI gateway for GameVortex Hub.

## What this server does

The server provides one stable internal API for:

- Chat: `POST /chat`
- Image: `POST /generate`
- Video: `POST /video`
- Video status: `GET /status?task_id=...`
- Health: `GET /health`
- Private health: `GET /health/private`
- Model list: `GET /models`

The gateway is deliberately separated from the Next.js application.

## Important architecture

```text
GameVortex Hub
      |
      v
GameVortex AI Server
      |
      +---- Chat backend
      |
      +---- Image backend
      |
      +---- Video backend
```

The backend URLs are configured with environment variables. This allows
the GPU machine to use vLLM, llama.cpp, ComfyUI, Diffusers, or another
self-hosted inference runtime without changing the GameVortex Hub API.

## Security

Set `GAMEVORTEX_AI_SERVER_KEY` in production.

Requests can authenticate with:

```text
Authorization: Bearer <key>
```

or:

```text
X-GameVortex-Key: <key>
```

Do not put the key in `NEXT_PUBLIC_*` variables.

## Run

Install dependencies:

```bash
pip install -r requirements.txt
```

Start:

```bash
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

## Current state

The gateway and provider adapters are implemented.

The actual GPU inference backends and model weights are NOT bundled in
this repository yet. They must be deployed on the GPU machine and then
their private URLs must be configured through the environment variables.
