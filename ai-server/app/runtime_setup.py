from __future__ import annotations

from .chat_runtime import ChatRuntime
from .config import config
from .image_runtime import ImageRuntime
from .models import ModelManager
from .video_runtime import VideoRuntime


def setup_model_manager() -> ModelManager:
    manager = ModelManager()

    manager.register_model(
        name=config.chat_model,
        kind="chat",
        runtime=ChatRuntime(config.chat_model),
        provider="gamevortex",
        enabled=True,
    )

    manager.register_model(
        name=config.image_model,
        kind="image",
        runtime=ImageRuntime(config.image_model),
        provider="gamevortex",
        enabled=True,
    )

    manager.register_model(
        name=config.video_model,
        kind="video",
        runtime=VideoRuntime(config.video_model),
        provider="gamevortex",
        enabled=True,
    )

    return manager


model_manager = setup_model_manager()
