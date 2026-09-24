from __future__ import annotations

from typing import Any

from fastapi import Depends, FastAPI, HTTPException

from .config import config
from .health import get_model_status, get_server_health
from .runtime_setup import model_manager
from .security import require_ai_server_auth


APP_NAME = "GameVortex AI Server"
APP_VERSION = "1.1.0"


app = FastAPI(
    title=APP_NAME,
    version=APP_VERSION,
    description=(
        "Private AI gateway for GameVortex Hub. "
        "Routes Chat, Image and Video requests to "
        "self-hosted inference backends."
    ),
)


@app.get("/")
async def root() -> dict[str, str]:
    return {
        "service": APP_NAME,
        "version": APP_VERSION,
        "status": "online",
    }


@app.get("/health")
async def health() -> dict[str, Any]:
    return get_server_health()


@app.get(
    "/health/private",
    dependencies=[Depends(require_ai_server_auth)],
)
async def private_health() -> dict[str, Any]:
    return {
        **get_server_health(),
        "authenticated": True,
    }


@app.get(
    "/models",
    dependencies=[Depends(require_ai_server_auth)],
)
async def list_models() -> dict[str, Any]:
    return {
        "models": get_model_status(),
    }




@app.post(
    "/responses",
    dependencies=[Depends(require_ai_server_auth)],
)
async def responses(
    payload: dict[str, Any],
):
    """
    OpenAI Responses-compatible endpoint used by GameVortex Hub.

    The gateway converts the Responses input format into the
    OpenAI-compatible Chat Completions format understood by the
    configured self-hosted Chat backend.
    """

    model_name = str(
        payload.get(
            "model",
            config.chat_model,
        )
    ).strip()

    raw_input = payload.get("input", [])

    if not isinstance(raw_input, list):
        raise HTTPException(
            status_code=400,
            detail="Responses input must be an array.",
        )

    messages: list[dict[str, str]] = []

    for item in raw_input:
        if not isinstance(item, dict):
            continue

        role = str(
            item.get("role", "user")
        ).strip()

        content = item.get("content", [])

        if isinstance(content, list):
            text_parts: list[str] = []

            for part in content:
                if not isinstance(part, dict):
                    continue

                text_value = part.get("text")

                if isinstance(text_value, str):
                    text_parts.append(text_value)

            text = "".join(text_parts)
        else:
            text = str(content)

        if text.strip():
            messages.append(
                {
                    "role": (
                        "assistant"
                        if role == "assistant"
                        else role
                    ),
                    "content": text,
                }
            )

    if not messages:
        raise HTTPException(
            status_code=400,
            detail="Responses input does not contain usable messages.",
        )

    result = await model_manager.generate(
        model_name=model_name,
        payload={
            "prompt": messages[-1]["content"],
            "messages": messages,
            "max_output_tokens": payload.get(
                "max_output_tokens",
                2048,
            ),
        },
    )

    if not result.success:
        raise HTTPException(
            status_code=502,
            detail=result.error
            or "GameVortex Chat backend failed.",
        )

    output_text = str(result.output or "")

    if payload.get("stream") is True:
        from fastapi.responses import StreamingResponse

        async def event_stream():
            import json

            yield (
                "data: "
                + json.dumps(
                    {
                        "type": "response.output_text.delta",
                        "delta": output_text,
                    },
                    ensure_ascii=False,
                )
                + "\n\n"
            )

            yield (
                "data: "
                + json.dumps(
                    {
                        "type": "response.completed",
                    }
                )
                + "\n\n"
            )

            yield "data: [DONE]\n\n"

        return StreamingResponse(
            event_stream(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
            },
        )

    return {
        "id": "gamevortex-response",
        "object": "response",
        "status": "completed",
        "model": result.model,
        "output_text": output_text,
        "output": [
            {
                "type": "message",
                "role": "assistant",
                "content": [
                    {
                        "type": "output_text",
                        "text": output_text,
                    }
                ],
            }
        ],
    }


@app.post(
    "/chat",
    dependencies=[Depends(require_ai_server_auth)],
)
async def chat(
    payload: dict[str, Any],
) -> dict[str, Any]:
    prompt = str(
        payload.get("prompt", "")
    ).strip()

    if not prompt:
        raise HTTPException(
            status_code=400,
            detail="Chat prompt is required.",
        )

    model_name = str(
        payload.get(
            "model",
            config.chat_model,
        )
    ).strip()

    result = await model_manager.generate(
        model_name=model_name,
        payload=payload,
    )

    if not result.success:
        raise HTTPException(
            status_code=502,
            detail=result.error
            or "GameVortex Chat backend failed.",
        )

    return {
        "answer": result.output,
        "model": result.model,
        "provider": "gamevortex",
    }


@app.post(
    "/generate",
    dependencies=[Depends(require_ai_server_auth)],
)
async def generate_image(
    payload: dict[str, Any],
) -> dict[str, Any]:
    prompt = str(
        payload.get("prompt", "")
    ).strip()

    if not prompt:
        raise HTTPException(
            status_code=400,
            detail="Image prompt is required.",
        )

    model_name = str(
        payload.get(
            "model",
            config.image_model,
        )
    ).strip()

    result = await model_manager.generate(
        model_name=model_name,
        payload=payload,
    )

    if not result.success:
        raise HTTPException(
            status_code=502,
            detail=result.error
            or "GameVortex Image backend failed.",
        )

    return {
        "images": result.output,
        "model": result.model,
        "provider": "gamevortex",
    }


@app.post(
    "/video",
    dependencies=[Depends(require_ai_server_auth)],
)
async def create_video(
    payload: dict[str, Any],
) -> dict[str, Any]:
    prompt = str(
        payload.get("prompt", "")
    ).strip()

    if not prompt:
        raise HTTPException(
            status_code=400,
            detail="Video prompt is required.",
        )

    model_name = str(
        payload.get(
            "model",
            config.video_model,
        )
    ).strip()

    runtime = model_manager.runtimes.get(model_name)

    if runtime is None or not hasattr(runtime, "generate"):
        raise HTTPException(
            status_code=502,
            detail="GameVortex Video runtime is unavailable.",
        )

    result = await model_manager.generate(
        model_name=model_name,
        payload=payload,
    )

    if not result.success or not result.task_id:
        raise HTTPException(
            status_code=502,
            detail=result.error
            or "GameVortex Video backend failed.",
        )

    return {
        "task_id": result.task_id,
        "model": result.model,
        "provider": "gamevortex",
        "status": result.status or "QUEUED",
    }


@app.get(
    "/status",
    dependencies=[Depends(require_ai_server_auth)],
)
async def video_status(
    task_id: str,
    model: str | None = None,
) -> dict[str, Any]:
    task_id = task_id.strip()

    if not task_id:
        raise HTTPException(
            status_code=400,
            detail="task_id is required.",
        )

    model_name = (
        model.strip()
        if model
        else config.video_model
    )

    runtime = model_manager.runtimes.get(model_name)

    if runtime is None or not hasattr(
        runtime,
        "status",
    ):
        raise HTTPException(
            status_code=502,
            detail="GameVortex Video status runtime is unavailable.",
        )

    result = await runtime.status(task_id)

    if result.error and not result.status:
        raise HTTPException(
            status_code=502,
            detail=result.error,
        )

    return {
        "task_id": task_id,
        "status": result.status or "PROCESSING",
        "model": result.model,
        "provider": "gamevortex",
        "file_id": result.file_id,
        "url": result.url,
        "error": result.error,
    }
