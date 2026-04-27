"""
FastAPI application entry: mounts routers and exposes process health.
"""

from pathlib import Path
from typing import Annotated

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

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


def _safe_static_file(relative: str) -> Path | None:
    """Resolve a file under static/; reject traversal outside that directory."""
    rel = (relative or "").replace("\\", "/").strip("/")
    if not rel or any(p == ".." for p in Path(rel).parts):
        return None
    base = _STATIC_ROOT.resolve()
    target = (base / rel).resolve()
    try:
        target.relative_to(base)
    except ValueError:
        return None
    return target if target.is_file() else None


# Production Docker image copies Vite output to backend/static (see repo Dockerfile).
# Starlette StaticFiles(html=True) does NOT fall back to index.html for paths like
# /remote-capture (only for "/" and directory URLs), so we serve files when present
# and otherwise return index.html for React Router.
_index = _STATIC_ROOT / "index.html"
if _index.is_file():

    @app.get("/")
    def spa_root():
        return FileResponse(_index)

    @app.get("/{full_path:path}")
    def spa_fallback(full_path: str):
        existing = _safe_static_file(full_path)
        if existing is not None:
            return FileResponse(existing)
        return FileResponse(_index)
