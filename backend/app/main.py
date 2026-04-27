"""
FastAPI application entry: mounts routers and exposes process health.
"""

from pathlib import Path
from typing import Annotated

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse
from starlette.staticfiles import StaticFiles

from app.api.routes import analysis, chat, fleet, frames, results
from app.core.config import Settings, get_settings

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


@app.get("/favicon.ico")
def favicon_ico():
    """Avoid 404 JSON from StaticFiles; browsers request /favicon.ico even when index.html links to .svg."""
    return RedirectResponse(url="/favicon.svg", status_code=307)


# Production Docker image copies Vite output to backend/static (see repo Dockerfile).
_spa_dir = Path(__file__).resolve().parent.parent / "static"
if (_spa_dir / "index.html").is_file():
    app.mount("/", StaticFiles(directory=str(_spa_dir), html=True), name="spa")
