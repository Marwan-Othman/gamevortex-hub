from __future__ import annotations

import hmac

from fastapi import Header, HTTPException

from .config import config


def _extract_bearer_token(
    authorization: str | None,
) -> str | None:
    if not authorization:
        return None

    scheme, _, token = authorization.partition(" ")

    if scheme.lower() != "bearer":
        return None

    token = token.strip()
    return token or None


def _is_valid_key(provided_key: str | None) -> bool:
    configured_key = config.server_key

    if not configured_key and config.environment != "production":
        return True

    if not configured_key or not provided_key:
        return False

    return hmac.compare_digest(
        provided_key,
        configured_key,
    )


def require_ai_server_auth(
    authorization: str | None = Header(default=None),
    x_gamevortex_key: str | None = Header(default=None),
) -> None:
    bearer_token = _extract_bearer_token(authorization)

    provided_key = bearer_token or (
        x_gamevortex_key.strip()
        if x_gamevortex_key
        else None
    )

    if _is_valid_key(provided_key):
        return

    if (
        not config.server_key
        and config.environment == "production"
    ):
        raise HTTPException(
            status_code=503,
            detail=(
                "GameVortex AI server authentication "
                "is not configured."
            ),
        )

    raise HTTPException(
        status_code=401,
        detail="Invalid GameVortex AI server credentials.",
    )
