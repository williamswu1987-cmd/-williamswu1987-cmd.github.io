#!/usr/bin/env python3
"""Minimal Protiva entitlement + usage API (stdlib only)."""
from __future__ import annotations

import hashlib
import hmac
import json
import os
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

HOST = "127.0.0.1"
PORT = int(os.environ.get("PROTIVA_API_PORT", "8791"))
DATA_DIR = Path(os.environ.get("PROTIVA_DATA", "/var/lib/protiva"))
SECRET = os.environ.get("PROTIVA_SECRET", "protiva-dev-change-me").encode()
FREE_DAILY = int(os.environ.get("PROTIVA_FREE_DAILY", "3"))

LOCK = threading.Lock()
DATA_DIR.mkdir(parents=True, exist_ok=True)
DB_PATH = DATA_DIR / "store.json"


def today() -> str:
    return time.strftime("%Y-%m-%d", time.gmtime())


def load_db() -> dict:
    if not DB_PATH.exists():
        return {"devices": {}}
    try:
        return json.loads(DB_PATH.read_text())
    except Exception:
        return {"devices": {}}


def save_db(db: dict) -> None:
    tmp = DB_PATH.with_suffix(".tmp")
    tmp.write_text(json.dumps(db, indent=2, sort_keys=True))
    tmp.replace(DB_PATH)


def sign(payload: str) -> str:
    return hmac.new(SECRET, payload.encode(), hashlib.sha256).hexdigest()


def device_row(db: dict, device_id: str) -> dict:
    row = db["devices"].setdefault(
        device_id,
        {"lookups": {}, "pro": None},
    )
    return row


def is_pro(row: dict) -> bool:
    pro = row.get("pro") or {}
    if not pro.get("active"):
        return False
    exp = pro.get("expiresAt") or 0
    return time.time() * 1000 < exp


def status_for(device_id: str) -> dict:
    with LOCK:
        db = load_db()
        row = device_row(db, device_id)
        day = today()
        used = int(row.get("lookups", {}).get(day, 0))
        pro = is_pro(row)
        save_db(db)
    return {
        "ok": True,
        "deviceId": device_id,
        "pro": pro,
        "plan": (row.get("pro") or {}).get("plan"),
        "expiresAt": (row.get("pro") or {}).get("expiresAt"),
        "lookupsToday": used,
        "freeLimit": FREE_DAILY,
        "remaining": 10**9 if pro else max(0, FREE_DAILY - used),
        "server": True,
    }


class Handler(BaseHTTPRequestHandler):
    server_version = "ProtivaAPI/1.0"

    def log_message(self, fmt: str, *args) -> None:
        print("[%s] %s" % (self.log_date_time_string(), fmt % args))

    def _cors(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")

    def _json(self, code: int, body: dict) -> None:
        raw = json.dumps(body).encode()
        self.send_response(code)
        self._cors()
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def _read_json(self) -> dict:
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0:
            return {}
        raw = self.rfile.read(length)
        try:
            return json.loads(raw.decode() or "{}")
        except Exception:
            return {}

    def do_OPTIONS(self) -> None:  # noqa: N802
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        path = parsed.path.rstrip("/") or "/"
        qs = parse_qs(parsed.query)

        if path in ("/protiva-api/v1/health", "/v1/health", "/health"):
            return self._json(200, {"ok": True, "service": "protiva"})

        if path in ("/protiva-api/v1/status", "/v1/status"):
            device_id = (qs.get("deviceId") or [""])[0].strip()
            if not device_id:
                return self._json(400, {"ok": False, "error": "deviceId required"})
            return self._json(200, status_for(device_id))

        return self._json(404, {"ok": False, "error": "not found"})

    def do_POST(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        path = parsed.path.rstrip("/") or "/"
        body = self._read_json()
        device_id = str(body.get("deviceId") or "").strip()
        if not device_id and path not in ("/protiva-api/v1/health", "/v1/health"):
            return self._json(400, {"ok": False, "error": "deviceId required"})

        if path in ("/protiva-api/v1/usage/consume", "/v1/usage/consume"):
            with LOCK:
                db = load_db()
                row = device_row(db, device_id)
                if is_pro(row):
                    save_db(db)
                    return self._json(
                        200,
                        {
                            "ok": True,
                            "pro": True,
                            "remaining": 10**9,
                            "lookupsToday": 0,
                            "freeLimit": FREE_DAILY,
                        },
                    )
                day = today()
                used = int(row.setdefault("lookups", {}).get(day, 0))
                if used >= FREE_DAILY:
                    save_db(db)
                    return self._json(
                        200,
                        {
                            "ok": False,
                            "reason": "limit",
                            "remaining": 0,
                            "lookupsToday": used,
                            "freeLimit": FREE_DAILY,
                            "pro": False,
                        },
                    )
                row["lookups"][day] = used + 1
                save_db(db)
                left = FREE_DAILY - (used + 1)
            return self._json(
                200,
                {
                    "ok": True,
                    "pro": False,
                    "remaining": left,
                    "lookupsToday": used + 1,
                    "freeLimit": FREE_DAILY,
                },
            )

        if path in ("/protiva-api/v1/pro/activate", "/v1/pro/activate"):
            plan = str(body.get("plan") or "monthly")
            if plan not in ("monthly", "yearly"):
                return self._json(400, {"ok": False, "error": "bad plan"})
            days = 365 if plan == "yearly" else 31
            expires = int(time.time() * 1000) + days * 86400000
            token_payload = f"{device_id}|{plan}|{expires}"
            token = sign(token_payload)
            with LOCK:
                db = load_db()
                row = device_row(db, device_id)
                row["pro"] = {
                    "active": True,
                    "plan": plan,
                    "expiresAt": expires,
                    "token": token,
                    "source": "server-mock-checkout",
                    "purchasedAt": int(time.time() * 1000),
                }
                save_db(db)
            return self._json(
                200,
                {
                    "ok": True,
                    "pro": True,
                    "plan": plan,
                    "expiresAt": expires,
                    "token": token,
                    "mock": True,
                    "note": "Replace with App Store / Stripe webhook before charging real money.",
                },
            )

        if path in ("/protiva-api/v1/pro/restore", "/v1/pro/restore"):
            st = status_for(device_id)
            return self._json(200, {"ok": bool(st.get("pro")), **st})

        if path in ("/protiva-api/v1/feedback", "/v1/feedback"):
            # Optional analytics sink — does not affect client ranking by itself
            with LOCK:
                db = load_db()
                row = device_row(db, device_id)
                fb = row.setdefault("feedback", [])
                fb.append(
                    {
                        "at": int(time.time() * 1000),
                        "dishId": body.get("dishId"),
                        "restaurantId": body.get("restaurantId"),
                        "exists": body.get("exists"),
                        "taste": body.get("taste"),
                    }
                )
                row["feedback"] = fb[-200:]
                save_db(db)
            return self._json(200, {"ok": True})

        return self._json(404, {"ok": False, "error": "not found"})


def main() -> None:
    httpd = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"Protiva API on http://{HOST}:{PORT} data={DATA_DIR}", flush=True)
    httpd.serve_forever()


if __name__ == "__main__":
    main()
