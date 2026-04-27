"""
FastAPI application entry: mounts routers and exposes process health.
"""

from pathlib import Path
from typing import Annotated

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.staticfiles import StaticFiles

from app.api.routes import analysis, chat, fleet, frames, results
from app.core.config import Settings, get_settings
from app.middleware.spa_icon_probes import SpaIconProbeMiddleware

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
app.add_middleware(SpaIconProbeMiddleware)

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


# Production Docker image copies Vite output to backend/static (see repo Dockerfile).
if (_STATIC_ROOT / "index.html").is_file():
    app.mount("/", StaticFiles(directory=str(_STATIC_ROOT), html=True), name="spa")
