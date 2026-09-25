from __future__ import annotations

from typing import Any

import httpx

from .config import config
from .models import ModelResult, ModelRuntime


class VideoRuntime(ModelRuntime):
    """
    Adapter for a self-hosted asynchronous Video backend.

    Create:
        POST {GAMEVORTEX_VIDEO_BACKEND_URL}/generate

    Status:
        GET {GAMEVORTEX_VIDEO_BACKEND_URL}/status?taskId=...

    The backend is expected to return a task identifier.
    """

    kind = "video"

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
                error="Video prompt is required.",
            )

        base_url = config.video_backend_url.rstrip("/")

        if not base_url:
            return ModelResult(
                success=False,
                model=self.model_name,
                error=(
                    "GAMEVORTEX_VIDEO_BACKEND_URL "
                    "is not configured."
                ),
            )

        request_body = {
            "model": self.model_name,
            "prompt": prompt,
            "image_url": payload.get("image_url"),
            "duration": payload.get("duration", 5),
            "resolution": payload.get("resolution"),
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
                error="Video backend timed out.",
            )
        except httpx.HTTPError as exc:
            return ModelResult(
                success=False,
                model=self.model_name,
                error=f"Video backend request failed: {exc}",
            )
        except ValueError:
            return ModelResult(
                success=False,
                model=self.model_name,
                error="Video backend returned invalid JSON.",
            )

        task_id = data.get("taskId") or data.get("task_id")

        if not task_id:
            return ModelResult(
                success=False,
                model=self.model_name,
                error=(
                    "Video backend did not return "
                    "a task ID."
                ),
            )

        return ModelResult(
            success=True,
            model=self.model_name,
            task_id=str(task_id),
            status="QUEUED",
        )

    async def status(
        self,
        task_id: str,
    ) -> ModelResult:
        base_url = config.video_backend_url.rstrip("/")

        if not base_url:
            return ModelResult(
                success=False,
                model=self.model_name,
                error=(
                    "GAMEVORTEX_VIDEO_BACKEND_URL "
                    "is not configured."
                ),
            )

        try:
            async with httpx.AsyncClient(
                timeout=config.request_timeout_seconds,
            ) as client:
                response = await client.get(
                    f"{base_url}/status",
                    params={"taskId": task_id},
                )

            response.raise_for_status()
            data = response.json()

        except httpx.TimeoutException:
            return ModelResult(
                success=False,
                model=self.model_name,
                error="Video status request timed out.",
            )
        except httpx.HTTPError as exc:
            return ModelResult(
                success=False,
                model=self.model_name,
                error=f"Video status request failed: {exc}",
            )
        except ValueError:
            return ModelResult(
                success=False,
                model=self.model_name,
                error="Video status returned invalid JSON.",
            )

        status = str(
            data.get("status", "PROCESSING")
        ).upper()

        normalized = {
            "PENDING": "QUEUED",
            "QUEUED": "QUEUED",
            "PROCESSING": "PROCESSING",
            "RUNNING": "PROCESSING",
            "COMPLETED": "COMPLETED",
            "SUCCESS": "COMPLETED",
            "FAILED": "FAILED",
            "ERROR": "FAILED",
        }.get(status, "PROCESSING")

        return ModelResult(
            success=normalized != "FAILED",
            model=self.model_name,
            status=normalized,
            task_id=task_id,
            file_id=(
                str(data["fileId"])
                if data.get("fileId") is not None
                else None
            ),
            url=(
                str(data["url"])
                if data.get("url") is not None
                else None
            ),
            error=(
                str(data["error"])
                if data.get("error") is not None
                else None
            ),
        )
