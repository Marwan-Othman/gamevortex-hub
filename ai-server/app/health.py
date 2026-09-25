from __future__ import annotations

import time
from typing import Any

from .config import config
from .runtime_setup import model_manager


def get_server_health() -> dict[str, Any]:
    models = model_manager.list_models()

    return {
        "status": "ok",
        "service": "GameVortex AI Server",
        "version": "1.0.0",
        "environment": config.environment,
        "timestamp": int(time.time()),
        "models": {
            "total": len(models),
            "enabled": len(
                model_manager.enabled_models()
            ),
            "items": [
                {
                    "name": model.name,
                    "kind": model.kind,
                    "provider": model.provider,
                    "enabled": model.enabled,
                }
                for model in models
            ],
        },
        "runtime": {
            "request_timeout_seconds": (
                config.request_timeout_seconds
            ),
            "max_concurrent_jobs": (
                config.max_concurrent_jobs
            ),
        },
    }


def get_model_status() -> list[dict[str, Any]]:
    return [
        {
            "name": model.name,
            "kind": model.kind,
            "provider": model.provider,
            "enabled": model.enabled,
        }
        for model in model_manager.list_models()
    ]
