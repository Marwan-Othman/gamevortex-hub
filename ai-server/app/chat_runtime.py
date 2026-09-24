from __future__ import annotations

from typing import Any

import httpx

from .config import config
from .models import ModelResult, ModelRuntime


class ChatRuntime(ModelRuntime):
    """
    Adapter for an OpenAI-compatible self-hosted Chat backend.

    Expected endpoint:
        POST {GAMEVORTEX_CHAT_BACKEND_URL}/chat/completions

    This allows GameVortex to use a local vLLM, llama.cpp,
    or another OpenAI-compatible inference server.
    """

    kind = "chat"

    def __init__(self, model_name: str) -> None:
        self.model_name = model_name

    async def generate(
        self,
        payload: dict[str, Any],
    ) -> ModelResult:
        prompt = str(
            payload.get("prompt", "")
        ).strip()

        if not prompt:
            return ModelResult(
                success=False,
                model=self.model_name,
                error="Chat prompt is required.",
            )

        base_url = config.chat_backend_url.rstrip("/")

        if not base_url:
            return ModelResult(
                success=False,
                model=self.model_name,
                error=(
                    "GAMEVORTEX_CHAT_BACKEND_URL "
                    "is not configured."
                ),
            )

        messages = payload.get("messages")

        if not isinstance(messages, list) or not messages:
            messages = [
                {
                    "role": "user",
                    "content": prompt,
                }
            ]

        request_body = {
            "model": self.model_name,
            "messages": messages,
            "max_tokens": payload.get(
                "max_output_tokens",
                2048,
            ),
        }

        if payload.get("temperature") is not None:
            request_body["temperature"] = payload["temperature"]

        try:
            async with httpx.AsyncClient(
                timeout=config.request_timeout_seconds,
            ) as client:
                response = await client.post(
                    f"{base_url}/chat/completions",
                    json=request_body,
                )

            response.raise_for_status()
            data = response.json()

        except httpx.TimeoutException:
            return ModelResult(
                success=False,
                model=self.model_name,
                error="Chat backend timed out.",
            )
        except httpx.HTTPError as exc:
            return ModelResult(
                success=False,
                model=self.model_name,
                error=f"Chat backend request failed: {exc}",
            )
        except ValueError:
            return ModelResult(
                success=False,
                model=self.model_name,
                error="Chat backend returned invalid JSON.",
            )

        try:
            text = data["choices"][0]["message"]["content"]
        except (KeyError, IndexError, TypeError):
            return ModelResult(
                success=False,
                model=self.model_name,
                error=(
                    "Chat backend returned an "
                    "unexpected response."
                ),
            )

        return ModelResult(
            success=True,
            model=self.model_name,
            output=str(text),
        )
