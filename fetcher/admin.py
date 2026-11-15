#!/usr/bin/env python3
"""Sentimeter settings service: shared settings and edits for everyone who uses the site.

Listens on 127.0.0.1 only; nginx forwards /api/ to it. Open to the public by
default. Set SENTIMETER_REQUIRE_KEY=1 in /etc/sentimeter.env to require
"Authorization: Bearer <SENTIMETER_ADMIN_KEY>" again.

Safeguards that apply to everyone: the monthly post limit cannot exceed
SENTIMETER_MAX_MONTHLY (default 1000), each Apify run is capped in posts and in
dollars (fetch.py), manual runs are limited to one per 30 minutes, and writes
are rate limited per visitor.

  GET  /api/settings   settings, which keys are set (never their values), usage
  PUT  /api/settings   save accounts, actors, keyword search toggles, monthly limit
  POST /api/keys       set APIFY_TOKEN / YOUTUBE_API_KEY (write-only)
  POST /api/run        start today's social collection now (counts toward the limit)
  GET  /api/status     whether a run is going, and the end of the fetch log
  GET  /api/shared     shared alerts, label corrections, stars, tags, hidden posts, blocked authors
  PUT  /api/shared/alerts         replace the alert list
  POST /api/shared/edits          merge edits {meta:{id:{...}|null}, overrides:{id:label|null}, blocked:[...]}
  POST /api/import?step=start|append|finish   upload an imported file in chunks (100 rows each)
  DELETE /api/import              remove the imported file
"""
import hmac, json, os, re, subprocess, sys, threading, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fetch  # noqa: E402  (settings defaults, paths, usage)

ENV_FILE = os.environ.get("SENTIMETER_ENV", "/etc/sentimeter.env")
LOG_FILE = os.environ.get("SENTIMETER_LOG", "/var/log/sentimeter/fetch.log")
FETCH_CMD = os.environ.get("SENTIMETER_FETCH_CMD", "/usr/local/bin/sentimeter-fetch --only social --force").split()
SHARED_PATH = os.environ.get("SENTIMETER_SHARED", "/var/lib/sentimeter/shared.json")
DATA_DIR = os.environ.get("SENTIMETER_DATA_DIR", os.path.join(fetch.ROOT, "public/data"))
LOCK = threading.Lock()
RATE = {}
LAST_MANUAL_RUN = [0.0]
IMPORT_BUF = {}
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
        if not 0 <= n <= max_monthly():
            raise ValueError(f"The monthly limit can be at most {max_monthly()} posts on this server.")
        s["monthly_limit"] = n
    if "run_after" in body:
        if not re.fullmatch(r"([01]\d|2[0-3]):[0-5]\d", str(body["run_after"])):
            raise ValueError("run_after must be HH:MM")
        s["run_after"] = body["run_after"]
    return s


def max_monthly():
    try:
        return int(read_env().get("SENTIMETER_MAX_MONTHLY") or 1000)
    except ValueError:
        return 1000


def load_shared():
    try:
        return json.load(open(SHARED_PATH))
    except Exception:
        return {"alerts": None, "meta": {}, "overrides": {}, "blocked": [], "updated": 0}


def save_shared(d):
    d["updated"] = int(time.time() * 1000)
    os.makedirs(os.path.dirname(SHARED_PATH), exist_ok=True)
    tmp = SHARED_PATH + ".tmp"
    json.dump(d, open(tmp, "w"), ensure_ascii=False, separators=(",", ":"))
    os.replace(tmp, SHARED_PATH)


def short(v, n=300):
    return str(v)[:n]


def clean_alert(a):
    lst = lambda x, n=200: [short(s, 120) for s in (x or []) if str(s).strip()][:n]
    return {"id": short(a.get("id") or "a" + str(int(time.time() * 1000)), 40), "name": short(a.get("name") or "Untitled alert", 80),
            "keywords": lst(a.get("keywords")), "excluded": lst(a.get("excluded")), "langs": lst(a.get("langs"), 20),
            "locations": lst(a.get("locations"), 50), "unknown": bool(a.get("unknown", True)), "sources": lst(a.get("sources"), 20),
            "tracked": a.get("tracked") is not False, "srcV3": True}


def clean_meta(m):
    out = {}
    for k in ("star", "done", "del"):
        if m.get(k):
            out[k] = True
    tags = [short(x, 40) for x in (m.get("tags") or []) if str(x).strip()][:20]
    if tags:
        out["tags"] = tags
    return out or None


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

    def client(self):
        return self.headers.get("X-Forwarded-For", self.client_address[0]).split(",")[0].strip()

    def limited(self, per_min=120):
        now = time.time()
        ip = self.client()
        hits = [t for t in RATE.get(ip, []) if now - t < 60]
        hits.append(now)
        RATE[ip] = hits
        if len(hits) > per_min:
            self.send(429, {"error": "Too many changes at once. Wait a minute and try again."})
            return True
        return False

    def authed(self):
        env = read_env()
        if env.get("SENTIMETER_REQUIRE_KEY") != "1":
            return True
        key = env.get("SENTIMETER_ADMIN_KEY", "")
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
                "running": running(), "public": read_env().get("SENTIMETER_REQUIRE_KEY") != "1", "max_monthly": max_monthly(),
                "next_manual_run_in": max(0, int(LAST_MANUAL_RUN[0] + 1800 - time.time()))}

    def do_GET(self):
        if not self.authed():
            return
        if self.path == "/api/settings":
            return self.send(200, self.overview())
        if self.path == "/api/shared":
            return self.send(200, load_shared())
        if self.path == "/api/status":
            tail = []
            try:
                tail = open(LOG_FILE).read().splitlines()[-25:]
            except Exception:
                pass
            return self.send(200, {"running": running(), "log": tail})
        self.send(404, {"error": "Not found"})

    def do_PUT(self):
        if not self.authed() or self.limited():
            return
        if self.path == "/api/shared/alerts":
            try:
                alerts = self.body().get("alerts")
                if not isinstance(alerts, list) or not 1 <= len(alerts) <= 50:
                    raise ValueError("Send 1 to 50 alerts")
                alerts = [clean_alert(a) for a in alerts]
            except (ValueError, TypeError, AttributeError, json.JSONDecodeError) as e:
                return self.send(400, {"error": str(e)})
            with LOCK:
                d = load_shared()
                d["alerts"] = alerts
                save_shared(d)
            return self.send(200, {"ok": True, "updated": d["updated"]})
        if self.path != "/api/settings":
            return self.send(404, {"error": "Not found"})
        # (settings validated below; monthly_limit is capped by SENTIMETER_MAX_MONTHLY)
        try:
            s = clean_settings(self.body())
        except (ValueError, TypeError, json.JSONDecodeError) as e:
            return self.send(400, {"error": str(e)})
        os.makedirs(os.path.dirname(fetch.SETTINGS_PATH), exist_ok=True)
        tmp = fetch.SETTINGS_PATH + ".tmp"
        json.dump(s, open(tmp, "w"), indent=2)
        os.replace(tmp, fetch.SETTINGS_PATH)
        self.send(200, self.overview())

    def do_DELETE(self):
        if not self.authed() or self.limited():
            return
        if self.path == "/api/import":
            for f in ("imported.json",):
                try:
                    os.remove(os.path.join(DATA_DIR, f))
                except FileNotFoundError:
                    pass
            return self.send(200, {"ok": True})
        self.send(404, {"error": "Not found"})

    def do_POST(self):
        if not self.authed() or self.limited(240):
            return
        if self.path == "/api/shared/edits":
            try:
                b = self.body()
            except Exception as e:
                return self.send(400, {"error": str(e)})
            with LOCK:
                d = load_shared()
                for k, v in list((b.get("meta") or {}).items())[:500]:
                    v = clean_meta(v) if isinstance(v, dict) else None
                    if v:
                        d["meta"][short(k, 40)] = v
                    else:
                        d["meta"].pop(k, None)
                for k, v in list((b.get("overrides") or {}).items())[:500]:
                    if v in ("pos", "neu", "neg"):
                        d["overrides"][short(k, 40)] = v
                    else:
                        d["overrides"].pop(k, None)
                if isinstance(b.get("blocked"), list):
                    d["blocked"] = [short(x, 120) for x in b["blocked"]][:500]
                save_shared(d)
            return self.send(200, {"ok": True, "updated": d["updated"]})
        if self.path.startswith("/api/import"):
            step = self.path.partition("step=")[2]
            ip = self.client()
            try:
                b = self.body()
            except Exception as e:
                return self.send(400, {"error": str(e)})
            if step == "start":
                IMPORT_BUF[ip] = {"name": short(b.get("name") or "import", 120), "rows": []}
                return self.send(200, {"ok": True})
            buf = IMPORT_BUF.get(ip)
            if not buf:
                return self.send(400, {"error": "Start the upload first"})
            if step == "append":
                for r in (b.get("rows") or [])[:200]:
                    if isinstance(r, dict) and str(r.get("text", "")).strip():
                        buf["rows"].append({k: short(r.get(k, ""), 5000 if k == "text" else 300) for k in
                                            ("id", "text", "platform", "date", "author", "handle", "location", "lang", "reach", "url", "title", "gender", "age", "acct")})
                if len(buf["rows"]) > 20000:
                    IMPORT_BUF.pop(ip, None)
                    return self.send(400, {"error": "Imports are limited to 20,000 rows"})
                return self.send(200, {"ok": True, "rows": len(buf["rows"])})
            if step == "finish":
                IMPORT_BUF.pop(ip, None)
                os.makedirs(DATA_DIR, exist_ok=True)
                path = os.path.join(DATA_DIR, "imported.json")
                tmp = path + ".tmp"
                json.dump({"name": buf["name"], "uploaded": int(time.time() * 1000), "mentions": buf["rows"]}, open(tmp, "w"), ensure_ascii=False, separators=(",", ":"))
                os.replace(tmp, path)
                return self.send(200, {"ok": True, "rows": len(buf["rows"])})
            return self.send(400, {"error": "Unknown step"})
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
            wait = int(LAST_MANUAL_RUN[0] + 1800 - time.time())
            if wait > 0:
                return self.send(429, {"error": f"A run was started recently. Try again in {wait // 60 + 1} min."})
            LAST_MANUAL_RUN[0] = time.time()
            with open(LOG_FILE, "a") as logf:
                subprocess.Popen(FETCH_CMD, stdout=logf, stderr=logf, start_new_session=True)
            return self.send(202, {"started": True})
        self.send(404, {"error": "Not found"})


if __name__ == "__main__":
    port = int(os.environ.get("SENTIMETER_ADMIN_PORT", "8787"))
    print(f"sentimeter-admin on 127.0.0.1:{port}", file=sys.stderr)
    ThreadingHTTPServer(("127.0.0.1", port), H).serve_forever()
