"""
Intercept GET /favicon.ico and apple-touch probes before routing.

If Railway builds without the frontend (wrong root directory / no npm stage),
StaticFiles is never mounted and Starlette returns JSON {"detail":"Not Found"} for
these URLs — noisy in DevTools and mistaken for API failures.
Always returning the SVG removes that regardless of static bundle presence.
"""

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

_EMBEDDED_FAVICON_SVG = (
    b'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#4a9eff">'
    b'<path d="M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z"/></svg>'
)

_PROBE_PATHS = frozenset(
    (
        "/favicon.ico",
        "/apple-touch-icon.png",
        "/apple-touch-icon-precomposed.png",
    )
)


class SpaIconProbeMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        if request.method == "GET" and request.url.path in _PROBE_PATHS:
            return Response(
                content=_EMBEDDED_FAVICON_SVG,
                media_type="image/svg+xml",
                headers={"Cache-Control": "public, max-age=86400"},
            )
        return await call_next(request)
