from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class ModelInfo:
    name: str
    kind: str
    provider: str
    enabled: bool = False


@dataclass
class ModelResult:
    success: bool
    model: str
    output: Any = None
    error: str | None = None
    status: str | None = None
    task_id: str | None = None
    file_id: str | None = None
    url: str | None = None


class ModelRuntime:
    kind = "unknown"

    async def generate(
        self,
        payload: dict[str, Any],
    ) -> ModelResult:
        raise NotImplementedError


class ModelManager:
    def __init__(self) -> None:
        self.registry: dict[str, ModelInfo] = {}
        self.runtimes: dict[str, ModelRuntime] = {}

    def register_model(
        self,
        name: str,
        kind: str,
        runtime: ModelRuntime,
        provider: str = "gamevortex",
        enabled: bool = True,
    ) -> ModelInfo:
        model = ModelInfo(
            name=name,
            kind=kind,
            provider=provider,
            enabled=enabled,
        )
        self.registry[name] = model
        self.runtimes[name] = runtime
        return model

    def get_model(
        self,
        name: str,
    ) -> ModelInfo | None:
        return self.registry.get(name)

    def list_models(self) -> list[ModelInfo]:
        return list(self.registry.values())

    def enabled_models(self) -> list[ModelInfo]:
        return [
            model
            for model in self.registry.values()
            if model.enabled
        ]

    async def generate(
        self,
        model_name: str,
        payload: dict[str, Any],
    ) -> ModelResult:
        model = self.registry.get(model_name)

        if model is None:
            return ModelResult(
                success=False,
                model=model_name,
                error=(
                    f"Model '{model_name}' "
                    "is not registered."
                ),
            )

        if not model.enabled:
            return ModelResult(
                success=False,
                model=model_name,
                error=(
                    f"Model '{model_name}' "
                    "is disabled."
                ),
            )

        runtime = self.runtimes.get(model_name)

        if runtime is None:
            return ModelResult(
                success=False,
                model=model_name,
                error=(
                    f"Runtime for model '{model_name}' "
                    "is not configured."
                ),
            )

        try:
            result = await runtime.generate(payload)
        except Exception as exc:
            return ModelResult(
                success=False,
                model=model_name,
                error=str(exc),
            )

        result.model = model_name
        return result
