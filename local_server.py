#!/usr/bin/env python3
"""Loopback-only static server and fixed OmniRoute reverse proxy."""

import json
import os
import re
import urllib.error
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


ROOT = os.path.dirname(os.path.abspath(__file__))
HOST = "127.0.0.1"
PORT = 8778
UPSTREAM = "http://127.0.0.1:20128/v1/chat/completions"
PROXY_PATH = "/_omniroute/v1/chat/completions"
MAX_BODY = 2 * 1024 * 1024
ALLOWED_HOSTS = {"localhost:8778", "127.0.0.1:8778"}
ALLOWED_ORIGINS = {"http://localhost:8778", "http://127.0.0.1:8778"}


class Handler(SimpleHTTPRequestHandler):
    protocol_version = "HTTP/1.0"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def do_GET(self):
        if self.path == "/_hq/health":
            body = b'{"ok":true}'
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)
            return
        super().do_GET()

    def do_POST(self):
        if self.path != PROXY_PATH:
            self.send_error(404, "Not found")
            return
        if self.headers.get("Host", "").lower() not in ALLOWED_HOSTS:
            self.send_error(403, "Invalid Host")
            return
        origin = self.headers.get("Origin")
        if origin and origin not in ALLOWED_ORIGINS:
            self.send_error(403, "Cross-origin proxy requests are not allowed")
            return
        if self.headers.get_content_type() != "application/json":
            self.send_error(415, "Content-Type must be application/json")
            return

        try:
            length = int(self.headers.get("Content-Length", ""))
        except ValueError:
            self.send_error(411, "Content-Length is required")
            return
        if length < 1 or length > MAX_BODY:
            self.send_error(413, "Request body is empty or too large")
            return

        body = self.rfile.read(length)
        try:
            parsed = json.loads(body.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            self.send_error(400, "Request body must be valid UTF-8 JSON")
            return
        if not isinstance(parsed, dict):
            self.send_error(400, "Request body must be a JSON object")
            return

        headers = {"Content-Type": "application/json"}
        authorization = self.headers.get("Authorization", "")
        if authorization and re.fullmatch(r"Bearer [^\r\n]+", authorization):
            headers["Authorization"] = authorization
        request = urllib.request.Request(UPSTREAM, data=body, headers=headers, method="POST")

        try:
            response = urllib.request.urlopen(request, timeout=120)
        except urllib.error.HTTPError as error:
            response = error
        except (urllib.error.URLError, TimeoutError, OSError):
            self._json_error(502, "OmniRoute is unreachable at 127.0.0.1:20128.")
            return

        self.send_response(response.code)
        content_type = response.headers.get("Content-Type")
        if content_type:
            self.send_header("Content-Type", content_type)
        content_length = response.headers.get("Content-Length")
        if content_length:
            self.send_header("Content-Length", content_length)
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        try:
            while True:
                chunk = response.read(64 * 1024)
                if not chunk:
                    break
                self.wfile.write(chunk)
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            pass
        finally:
            response.close()

    def _json_error(self, status, message):
        body = json.dumps({"error": {"message": message}}).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)


if __name__ == "__main__":
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print("HospiQuery accessible sur http://localhost:%d" % PORT)
    server.serve_forever()
