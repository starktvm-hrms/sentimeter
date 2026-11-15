#!/usr/bin/env python3
"""Sentimeter settings service: lets the site's Sources page read and save server settings.

Listens on 127.0.0.1 only; nginx forwards /api/ to it. Every request needs
"Authorization: Bearer <SENTIMETER_ADMIN_KEY>" (from /etc/sentimeter.env).

  GET  /api/settings   settings, which keys are set (never their values), usage
  PUT  /api/settings   save accounts, actors, keyword search toggles, monthly limit
  POST /api/keys       set APIFY_TOKEN / YOUTUBE_API_KEY (write-only)
  POST /api/run        start today's social collection now (counts toward the limit)
  GET  /api/status     whether a run is going, and the end of the fetch log
"""
import hmac, json, os, re, subprocess, sys, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fetch  # noqa: E402  (settings defaults, paths, usage)

ENV_FILE = os.environ.get("SENTIMETER_ENV", "/etc/sentimeter.env")
LOG_FILE = os.environ.get("SENTIMETER_LOG", "/var/log/sentimeter/fetch.log")
FETCH_CMD = os.environ.get("SENTIMETER_FETCH_CMD", "/usr/local/bin/sentimeter-fetch --only social --force").split()
ACTOR_RE = re.compile(r"^[A-Za-z0-9_.-]{1,80}[~/][A-Za-z0-9_.-]{1,80}$")


def read_env():
    env = {}
    try:
        for line in open(ENV_FILE):
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip().strip('"').strip("'")
    except FileNotFoundError:
        pass
    return env


def write_env_keys(updates):
    lines = open(ENV_FILE).read().splitlines() if os.path.exists(ENV_FILE) else []
    seen = set()
    for i, line in enumerate(lines):
        k = line.split("=", 1)[0].strip()
        if k in updates:
            lines[i] = f"{k}={updates[k]}"
            seen.add(k)
    lines += [f"{k}={v}" for k, v in updates.items() if k not in seen]
    tmp = ENV_FILE + ".tmp"
    with open(os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600), "w") as f:
        f.write("\n".join(lines) + "\n")
    os.replace(tmp, ENV_FILE)


def clean_settings(body):
    s = fetch.load_settings()
    acc = body.get("accounts", {})
    for p in fetch.PLATFORMS:
        vals = acc.get(p, s["accounts"].get(p, []))
        if not isinstance(vals, list):
            raise ValueError(f"accounts.{p} must be a list")
        vals = [str(v).strip() for v in vals if str(v).strip()]
        if len(vals) > 25 or any(len(v) > 200 or "\n" in v or " " in v for v in vals):
            raise ValueError(f"accounts.{p}: up to 25 usernames or URLs, no spaces")
        s["accounts"][p] = vals
    for k, v in (body.get("actors") or {}).items():
        if k not in fetch.DEFAULT_ACTORS:
            continue
        v = str(v).strip() or fetch.DEFAULT_ACTORS[k]
        if not (ACTOR_RE.match(v) or (k == "youtube" and v == "youtube-data-api")):
            raise ValueError(f"actors.{k}: use an Apify actor ID like owner~actor-name")
        s["actors"][k] = v
    for k in ("x_search", "instagram_hashtags"):
        if k in (body.get("keyword_search") or {}):
            s["keyword_search"][k] = bool(body["keyword_search"][k])
    if "monthly_limit" in body:
        n = int(body["monthly_limit"])
        if not 0 <= n <= 100000:
            raise ValueError("monthly_limit must be between 0 and 100000")
        s["monthly_limit"] = n
    if "run_after" in body:
        if not re.fullmatch(r"([01]\d|2[0-3]):[0-5]\d", str(body["run_after"])):
            raise ValueError("run_after must be HH:MM")
        s["run_after"] = body["run_after"]
    return s


def running():
    try:
        out = subprocess.run(["pgrep", "-f", "fetcher/fetch.py"], capture_output=True, text=True).stdout.split()
        return any(int(pid) != os.getpid() for pid in out)
    except Exception:
        return False


class H(BaseHTTPRequestHandler):
    server_version = "sentimeter-admin"

    def log_message(self, fmt, *args):
        sys.stderr.write("%s %s\n" % (self.command, self.path))

    def send(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def authed(self):
        key = read_env().get("SENTIMETER_ADMIN_KEY", "")
        got = self.headers.get("Authorization", "").removeprefix("Bearer ").strip()
        if len(key) >= 24 and hmac.compare_digest(got.encode(), key.encode()):
            return True
        time.sleep(1.5)
        self.send(401, {"error": "Wrong admin key."})
        return False

    def body(self):
        n = int(self.headers.get("Content-Length") or 0)
        if n > 65536:
            raise ValueError("Request too large")
        return json.loads(self.rfile.read(n) or b"{}")

    def overview(self):
        env = read_env()
        s = fetch.load_settings()
        u = fetch.load_usage()
        month = fetch.local_now(s.get("timezone", "Asia/Kolkata")).strftime("%Y-%m")
        mu = u.get("months", {}).get(month, {"posts": 0, "runs": []})
        return {"settings": s, "keys": {"apify": bool(env.get("APIFY_TOKEN")), "youtube": bool(env.get("YOUTUBE_API_KEY"))},
                "usage": {"month": month, "used": mu.get("posts", 0), "runs": mu.get("runs", [])[-10:], "last_daily_run": u.get("last_daily_run")},
                "running": running()}

    def do_GET(self):
        if not self.authed():
            return
        if self.path == "/api/settings":
            return self.send(200, self.overview())
        if self.path == "/api/status":
            tail = []
            try:
                tail = open(LOG_FILE).read().splitlines()[-25:]
            except Exception:
                pass
            return self.send(200, {"running": running(), "log": tail})
        self.send(404, {"error": "Not found"})

    def do_PUT(self):
        if not self.authed():
            return
        if self.path != "/api/settings":
            return self.send(404, {"error": "Not found"})
        try:
            s = clean_settings(self.body())
        except (ValueError, TypeError, json.JSONDecodeError) as e:
            return self.send(400, {"error": str(e)})
        os.makedirs(os.path.dirname(fetch.SETTINGS_PATH), exist_ok=True)
        tmp = fetch.SETTINGS_PATH + ".tmp"
        json.dump(s, open(tmp, "w"), indent=2)
        os.replace(tmp, fetch.SETTINGS_PATH)
        self.send(200, self.overview())

    def do_POST(self):
        if not self.authed():
            return
        if self.path == "/api/keys":
            try:
                b = self.body()
            except Exception as e:
                return self.send(400, {"error": str(e)})
            up = {}
            for field, var in (("apify_token", "APIFY_TOKEN"), ("youtube_api_key", "YOUTUBE_API_KEY")):
                if field in b and b[field] is not None:
                    v = str(b[field]).strip()
                    if not re.fullmatch(r"[A-Za-z0-9_\-\.]{0,200}", v):
                        return self.send(400, {"error": f"{field} has unexpected characters"})
                    up[var] = v
            if up:
                write_env_keys(up)
            return self.send(200, self.overview())
        if self.path == "/api/run":
            if running():
                return self.send(409, {"error": "A collection run is already going."})
            with open(LOG_FILE, "a") as logf:
                subprocess.Popen(FETCH_CMD, stdout=logf, stderr=logf, start_new_session=True)
            return self.send(202, {"started": True})
        self.send(404, {"error": "Not found"})


if __name__ == "__main__":
    port = int(os.environ.get("SENTIMETER_ADMIN_PORT", "8787"))
    print(f"sentimeter-admin on 127.0.0.1:{port}", file=sys.stderr)
    ThreadingHTTPServer(("127.0.0.1", port), H).serve_forever()
