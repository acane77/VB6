"""Deterministic HTTP fixture server for offline-export browser acceptance."""
from __future__ import annotations

from http.server import SimpleHTTPRequestHandler
from pathlib import Path
from urllib.parse import urlsplit


def offline_fixture_handler(root: Path, report: Path, state: dict):
    root, report = Path(root), Path(report)

    class Handler(SimpleHTTPRequestHandler):
        extensions_map = {**SimpleHTTPRequestHandler.extensions_map,
                          '.webmanifest': 'application/manifest+json'}

        def log_message(self, *args):
            pass

        def translate_path(self, value):
            route = urlsplit(value).path
            for app in ('a', 'b', 'broken', 'failed'):
                prefix = '/apps/' + app + '/'
                if route.startswith(prefix):
                    return str(report / 'fixtures' / state[app] /
                               (route[len(prefix):] or 'index.html'))
            if route.startswith('/download/'):
                return str(report / 'download' /
                           (route[len('/download/'):] or 'index.html'))
            return super().translate_path(value)

        def end_headers(self):
            route = urlsplit(self.path).path
            # Service-worker update checks must receive the bytes currently
            # selected by the fixture, never a stale mtime-based 304 response.
            self.send_header('Cache-Control', 'no-store' if route.endswith('/service-worker.js') else 'no-cache')
            if route.startswith(('/apps/', '/download/')):
                self.send_header('Content-Security-Policy',
                    "default-src 'self'; script-src 'self'; worker-src 'self'; "
                    "style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; "
                    "font-src 'self' data:; connect-src 'self'; object-src 'none'")
            super().end_headers()

        def _send_bytes(self, body: bytes, content_type: str, status: int = 200):
            self.send_response(status)
            self.send_header('Content-Type', content_type)
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            route = urlsplit(self.path).path
            if route.endswith('/service-worker.js'):
                state['worker_requests'] += 1
                path = Path(self.translate_path(self.path))
                try:
                    body = path.read_bytes()
                except OSError:
                    self.send_error(404, 'Service worker fixture unavailable')
                    return
                # SimpleHTTPRequestHandler otherwise compares only whole-second
                # mtimes and can return 304 for two distinct generated releases.
                self._send_bytes(body, 'text/javascript; charset=utf-8')
                return
            if route == '/apps/broken/assets/raw.bin' and state['corrupt']:
                self._send_bytes(b'corrupted-upload', 'application/octet-stream')
                return
            if route.endswith('/api/data'):
                state['api_requests'] += 1
                available = state['api_available']
                body = b'{"networkOnly":true}' if available else b'{"networkOnly":false}'
                self._send_bytes(body, 'application/json', 200 if available else 503)
                return
            super().do_GET()

    return Handler
