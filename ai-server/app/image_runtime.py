from __future__ import annotations

from typing import Any

import httpx

from .config import config
from .models import ModelResult, ModelRuntime


class ImageRuntime(ModelRuntime):
    """
    Adapter for a self-hosted Image backend.

    Expected endpoint:
        POST {GAMEVORTEX_IMAGE_BACKEND_URL}/generate

    Expected response:
        {
            "images": [
                {"url": "..."}
            ]
        }
    """

    kind = "image"

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
                error="Image prompt is required.",
            )

        base_url = config.image_backend_url.rstrip("/")

        if not base_url:
            return ModelResult(
                success=False,
                model=self.model_name,
                error=(
                    "GAMEVORTEX_IMAGE_BACKEND_URL "
                    "is not configured."
                ),
            )

        request_body = {
            "model": self.model_name,
            "prompt": prompt,
            "width": payload.get("width", 1024),
            "height": payload.get("height", 1024),
            "num_images": payload.get("num_images", 1),
        }

        try:
            async with httpx.AsyncClient(
                timeout=config.request_timeout_seconds,
            ) as client:
                response = await client.post(
                    f"{base_url}/generate",
                    json=request_body,
                )

            response.raise_for_status()
            data = response.json()

        except httpx.TimeoutException:
            return ModelResult(
                success=False,
                model=self.model_name,
                error="Image backend timed out.",
            )
        except httpx.HTTPError as exc:
            return ModelResult(
                success=False,
                model=self.model_name,
                error=f"Image backend request failed: {exc}",
            )
        except ValueError:
            return ModelResult(
                success=False,
                model=self.model_name,
                error="Image backend returned invalid JSON.",
            )

        images = data.get("images")

        if not isinstance(images, list):
            return ModelResult(
                success=False,
                model=self.model_name,
                error=(
                    "Image backend returned an "
                    "unexpected response."
                ),
            )

        return ModelResult(
            success=True,
            model=self.model_name,
            output=images,
        )
