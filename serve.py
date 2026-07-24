#!/usr/bin/env python3
"""Dev static file server — same as `python -m http.server`, but sends
Cache-Control: no-store on every response.

http.server only ever sends Last-Modified, no cache-control/ETag headers,
which leaves browsers free to serve a stale copy from heuristic caching
(observed: Firefox kept an old index.html after edits, even though the
container was serving the current file, until a hard reload). no-store
makes every request re-fetch from the container instead.
"""
import http.server


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()


if __name__ == '__main__':
    http.server.test(HandlerClass=NoCacheHandler, port=8080)
