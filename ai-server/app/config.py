from __future__ import annotations

import os
from dataclasses import dataclass


def _get_env(name: str, default: str = "") -> str:
    return os.getenv(name, default).strip()


def _get_int(name: str, default: int) -> int:
    raw = _get_env(name)
    if not raw:
        return default

    try:
        value = int(raw)
    except ValueError:
        return default

    return value if value > 0 else default


@dataclass(frozen=True)
class AiServerConfig:
    environment: str
    server_key: str

    chat_model: str
    chat_backend_url: str

    image_model: str
    image_backend_url: str

    video_model: str
    video_backend_url: str

    request_timeout_seconds: int
    max_concurrent_jobs: int


def load_config() -> AiServerConfig:
    return AiServerConfig(
        environment=_get_env(
            "GAMEVORTEX_AI_ENV",
            "development",
        ),
        server_key=_get_env(
            "GAMEVORTEX_AI_SERVER_KEY",
        ),
        chat_model=_get_env(
            "GAMEVORTEX_CHAT_MODEL",
            "gamevortex-chat",
        ),
        chat_backend_url=_get_env(
            "GAMEVORTEX_CHAT_BACKEND_URL",
        ),
        image_model=_get_env(
            "GAMEVORTEX_IMAGE_MODEL",
            "gamevortex-image",
        ),
        image_backend_url=_get_env(
            "GAMEVORTEX_IMAGE_BACKEND_URL",
        ),
        video_model=_get_env(
            "GAMEVORTEX_VIDEO_MODEL",
            "gamevortex-video",
        ),
        video_backend_url=_get_env(
            "GAMEVORTEX_VIDEO_BACKEND_URL",
        ),
        request_timeout_seconds=_get_int(
            "GAMEVORTEX_AI_REQUEST_TIMEOUT_SECONDS",
            300,
        ),
        max_concurrent_jobs=_get_int(
            "GAMEVORTEX_AI_MAX_CONCURRENT_JOBS",
            1,
        ),
    )


config = load_config()
