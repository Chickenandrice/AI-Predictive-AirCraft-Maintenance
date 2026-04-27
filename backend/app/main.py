"""
FastAPI application entry: mounts routers and exposes process health.
"""

from pathlib import Path
from typing import Annotated

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from starlette.staticfiles import StaticFiles

from app.api.routes import analysis, chat, fleet, frames, results
from app.core.config import Settings, get_settings

_BACKEND_ROOT = Path(__file__).resolve().parent.parent
_STATIC_ROOT = _BACKEND_ROOT / "static"

_settings = get_settings()

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=_settings.cors_origin_list(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(fleet.router, prefix="/api")
app.include_router(frames.router, prefix="/api")
app.include_router(analysis.router, prefix="/api")
app.include_router(results.router, prefix="/api")
app.include_router(chat.router, prefix="/api")


@app.get("/health")
def health(settings: Annotated[Settings, Depends(get_settings)]):
    """Smoke check: Gemini model id and whether an API key is set (key value is never returned)."""
    return {
        "status": "ok",
        "chat_engine": "gemini",
        "gemini_vision_model": settings.gemini_vision_model,
        "gemini_api_configured": bool((settings.gemini_api_key or "").strip()),
    }


def _spa_icon_response() -> FileResponse:
    """Serve SPA favicon assets; avoids Starlette StaticFiles returning JSON 404 on browser probes."""
    pairs = (
        (_STATIC_ROOT / "favicon.svg", "image/svg+xml"),
        (_STATIC_ROOT / "favicon.ico", None),
    )
    for path, mime in pairs:
        if path.is_file():
            if mime:
                return FileResponse(path, media_type=mime)
            return FileResponse(path)
    raise HTTPException(
        status_code=503,
        detail="SPA static build has no favicon.svg or favicon.ico (rebuild frontend).",
    )


@app.get("/favicon.ico")
def favicon_ico():
    return _spa_icon_response()


@app.get("/apple-touch-icon.png")
def apple_touch_icon():
    return _spa_icon_response()


@app.get("/apple-touch-icon-precomposed.png")
def apple_touch_icon_precomposed():
    return _spa_icon_response()


# Production Docker image copies Vite output to backend/static (see repo Dockerfile).
if (_STATIC_ROOT / "index.html").is_file():
    app.mount("/", StaticFiles(directory=str(_STATIC_ROOT), html=True), name="spa")
