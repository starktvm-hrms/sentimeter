#!/usr/bin/env python3
"""Sentimeter settings service: login, shared settings and edits, and the collected data.

Listens on 127.0.0.1 only; nginx forwards /api/ to it. Every endpoint except
/api/auth/* needs a logged-in session (cookie) or "Authorization: Bearer
<SENTIMETER_ADMIN_KEY>". Users live in /var/lib/sentimeter/users.json with
scrypt password hashes. The first admin is created once with /api/auth/setup,
which needs a one-time secret whose SHA-256 is SETUP_TOKEN_SHA256 below.

Safeguards that apply to everyone: the monthly post limit cannot exceed
SENTIMETER_MAX_MONTHLY (default 5000), each Apify run is capped in posts and in
dollars (fetch.py), manual runs are limited to one per 30 minutes, and writes
are rate limited per visitor.

  POST /api/auth/login | logout, GET /api/auth/me, POST /api/auth/setup (first admin only)
  GET  /api/data/mentions.json | imported.json   collected data (login only)
  GET  /api/settings   settings, which keys are set (never their values), usage
  PUT  /api/settings   save accounts, actors, keyword search toggles, monthly limit
  POST /api/keys       set the Apify tokens (default, meta, x_linkedin, other) and YOUTUBE_API_KEY (write-only)
  POST /api/run        start today's social collection now (counts toward the limit)
  GET  /api/status     whether a run is going, and the end of the fetch log
  GET  /api/shared     shared alerts, label corrections, stars, tags, hidden posts, blocked authors
  PUT  /api/shared/alerts         replace the alert list
  POST /api/shared/edits          merge edits {meta:{id:{...}|null}, overrides:{id:label|null}, blocked:[...]}
  POST /api/import?step=start|append|finish   upload an imported file in chunks (100 rows each)
  DELETE /api/import              remove the imported file
"""
import hashlib, hmac, json, os, re, secrets, subprocess, sys, threading, time
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fetch  # noqa: E402  (settings defaults, paths, usage)

ENV_FILE = os.environ.get("SENTIMETER_ENV", "/etc/sentimeter.env")
LOG_FILE = os.environ.get("SENTIMETER_LOG", "/var/log/sentimeter/fetch.log")
FETCH_CMD = os.environ.get("SENTIMETER_FETCH_CMD", "/usr/local/bin/sentimeter-fetch --only social --force").split()
SCHEDULED_CMD = os.environ.get("SENTIMETER_SCHEDULED_CMD", "/usr/local/bin/sentimeter-fetch --only social").split()
SHARED_PATH = os.environ.get("SENTIMETER_SHARED", "/var/lib/sentimeter/shared.json")
DATA_DIR = fetch.DATA_DIR
OLD_PUBLIC_DATA = os.path.join(fetch.ROOT, "public/data")
USERS_PATH = os.environ.get("SENTIMETER_USERS", "/var/lib/sentimeter/users.json")
SESSIONS_PATH = os.environ.get("SENTIMETER_SESSIONS", "/var/lib/sentimeter/sessions.json")
SETUP_TOKEN_SHA256 = "8fa8c2a8630c85283fb7e86444d444cb55694efbaa90ae379ea2af1d11aeda12"
SESSION_DAYS = 30
COOKIE = "sm_session"
FAILS = {}
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
    for k in fetch.KEYWORD_JOBS:
        if k in (body.get("keyword_search") or {}):
            s["keyword_search"][k] = bool(body["keyword_search"][k])
    for k in ("google_news", "bing_news"):
        if k in (body.get("news") or {}):
            s.setdefault("news", {})[k] = bool(body["news"][k])
    if "include_mentions" in body:
        s["include_mentions"] = bool(body["include_mentions"])
    if "search_terms" in body:
        terms = [str(x).strip() for x in body["search_terms"] or [] if str(x).strip()]
        if len(terms) > 10 or any(len(x) > 60 or "\n" in x for x in terms):
            raise ValueError("Search terms: up to 10, each at most 60 characters")
        s["search_terms"] = terms
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


def now_local(s):
    from datetime import datetime, timezone, timedelta
    try:
        from zoneinfo import ZoneInfo
        return datetime.now(ZoneInfo(s.get("timezone", "Asia/Kolkata")))
    except Exception:
        return datetime.now(timezone(timedelta(hours=5, minutes=30)))


# ---------------- users and sessions ----------------

def _load(path, default):
    try:
        return json.load(open(path))
    except Exception:
        return default


def _save(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600), "w") as f:
        json.dump(data, f)
    os.replace(tmp, path)


def hash_pw(password, salt=None):
    salt = salt or secrets.token_hex(16)
    h = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt), n=2 ** 14, r=8, p=1, dklen=32).hex()
    return salt, h


def check_pw(user, password):
    _, h = hash_pw(password, user["salt"])
    return hmac.compare_digest(h, user["hash"])


def users():
    return _load(USERS_PATH, {"users": []}).get("users", [])


def new_session(email):
    tok = secrets.token_urlsafe(32)
    with LOCK:
        s = _load(SESSIONS_PATH, {})
        now = time.time()
        s = {k: v for k, v in s.items() if v.get("exp", 0) > now}
        s[hashlib.sha256(tok.encode()).hexdigest()] = {"email": email, "exp": now + SESSION_DAYS * 86400}
        _save(SESSIONS_PATH, s)
    return tok


def session_user(tok):
    if not tok:
        return None
    s = _load(SESSIONS_PATH, {}).get(hashlib.sha256(tok.encode()).hexdigest())
    if not s or s.get("exp", 0) < time.time():
        return None
    u = next((u for u in users() if u["email"] == s["email"]), None)
    return {"email": u["email"], "role": u.get("role", "admin")} if u else None


def end_session(tok):
    if tok:
        with LOCK:
            s = _load(SESSIONS_PATH, {})
            s.pop(hashlib.sha256(tok.encode()).hexdigest(), None)
            _save(SESSIONS_PATH, s)


def migrate_public_data():
    """Collected data used to sit in the public web folder. Move it behind login."""
    os.makedirs(DATA_DIR, exist_ok=True)
    for f in ("mentions.json", "imported.json"):
        old, new = os.path.join(OLD_PUBLIC_DATA, f), os.path.join(DATA_DIR, f)
        try:
            if os.path.exists(old):
                if not os.path.exists(new):
                    os.replace(old, new)
                else:
                    os.remove(old)
        except Exception as e:
            sys.stderr.write(f"data migration {f}: {e}\n")


def max_monthly():
    try:
        return int(read_env().get("SENTIMETER_MAX_MONTHLY") or 5000)
    except ValueError:
        return 5000


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
    """True while a fetch holds its lock file."""
    import fcntl
    try:
        with open(fetch.LOCK_PATH, "a") as f:
            fcntl.flock(f, fcntl.LOCK_EX | fcntl.LOCK_NB)
            fcntl.flock(f, fcntl.LOCK_UN)
        return False
    except OSError:
        return True


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

    def token(self):
        c = SimpleCookie()
        try:
            c.load(self.headers.get("Cookie", ""))
        except Exception:
            return ""
        return c[COOKIE].value if COOKIE in c else ""

    def set_cookie(self, tok, max_age):
        secure = "" if os.environ.get("SENTIMETER_INSECURE_COOKIE") == "1" else "; Secure"
        self._cookie = f"{COOKIE}={tok}; Path=/; HttpOnly; SameSite=Lax; Max-Age={max_age}{secure}"

    def end_headers(self):
        if getattr(self, "_cookie", None):
            self.send_header("Set-Cookie", self._cookie)
            self._cookie = None
        super().end_headers()

    def authed(self):
        self.user = session_user(self.token())
        if self.user:
            return True
        env = read_env()
        key = env.get("SENTIMETER_ADMIN_KEY", "")
        got = self.headers.get("Authorization", "").removeprefix("Bearer ").strip()
        if len(key) >= 24 and hmac.compare_digest(got.encode(), key.encode()):
            return True
        if got:
            time.sleep(1.5)
        self.send(401, {"error": "Please log in."})
        return False

    def auth_routes(self):
        """Handle /api/auth/*. Returns True when the request was handled."""
        path = self.path.split("?")[0]
        if not path.startswith("/api/auth/"):
            return False
        if path == "/api/auth/me" and self.command == "GET":
            u = session_user(self.token())
            self.send(200 if u else 401, {"user": u} if u else {"error": "Not logged in", "setup_needed": not users()})
            return True
        if path == "/api/auth/logout" and self.command == "POST":
            end_session(self.token())
            self.set_cookie("", 0)
            self.send(200, {"ok": True})
            return True
        if path == "/api/auth/login" and self.command == "POST":
            ip = self.client()
            now = time.time()
            fails = [x for x in FAILS.get(ip, []) if now - x < 900]
            if len(fails) >= 8:
                self.send(429, {"error": "Too many attempts. Try again in 15 minutes."})
                return True
            try:
                b = self.body()
            except Exception:
                b = {}
            email = str(b.get("email", "")).strip().lower()
            pw = str(b.get("password", ""))
            u = next((u for u in users() if u["email"] == email), None)
            if not u or not check_pw(u, pw):
                FAILS[ip] = fails + [now]
                time.sleep(1)
                self.send(401, {"error": "Email or password is incorrect."})
                return True
            FAILS.pop(ip, None)
            self.set_cookie(new_session(u["email"]), SESSION_DAYS * 86400)
            self.send(200, {"user": {"email": u["email"], "role": u.get("role", "admin")}})
            return True
        if path == "/api/auth/setup" and self.command == "POST":
            try:
                b = self.body()
            except Exception:
                b = {}
            tok = str(b.get("token", ""))
            if users() or not hmac.compare_digest(hashlib.sha256(tok.encode()).hexdigest(), SETUP_TOKEN_SHA256):
                time.sleep(1.5)
                self.send(403, {"error": "Setup is not available."})
                return True
            email = str(b.get("email", "")).strip().lower()
            pw = str(b.get("password", ""))
            if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email) or len(pw) < 8:
                self.send(400, {"error": "Valid email and a password of 8+ characters required."})
                return True
            salt, h = hash_pw(pw)
            with LOCK:
                _save(USERS_PATH, {"users": [{"email": email, "salt": salt, "hash": h, "role": "admin", "created": int(time.time())}]})
            self.send(200, {"ok": True, "email": email})
            return True
        self.send(404, {"error": "Not found"})
        return True

    def body(self):
        n = int(self.headers.get("Content-Length") or 0)
        if n > 65536:
            raise ValueError("Request too large")
        return json.loads(self.rfile.read(n) or b"{}")

    def overview(self):
        env = read_env()
        s = fetch.load_settings()
        u = fetch.load_usage()
        month = now_local(s).strftime("%Y-%m")
        mu = u.get("months", {}).get(month, {"posts": 0, "runs": []})
        return {"settings": s, "keys": {"apify": bool(env.get("APIFY_TOKEN")), "apify_meta": bool(env.get("APIFY_TOKEN_META")), "apify_x_linkedin": bool(env.get("APIFY_TOKEN_X_LINKEDIN")),
                         "apify_other": bool(env.get("APIFY_TOKEN_OTHER")), "youtube": bool(env.get("YOUTUBE_API_KEY"))},
                "usage": {"month": month, "used": mu.get("posts", 0), "runs": mu.get("runs", [])[-10:], "last_daily_run": u.get("last_daily_run")},
                "running": running(), "public": True, "user": getattr(self, "user", None), "max_monthly": max_monthly(),
                "next_manual_run_in": max(0, int(LAST_MANUAL_RUN[0] + 1800 - time.time()))}

    def do_GET(self):
        if self.auth_routes() or not self.authed():
            return
        if self.path.split("?")[0] in ("/api/data/mentions.json", "/api/data/imported.json"):
            f = os.path.join(DATA_DIR, os.path.basename(self.path.split("?")[0]))
            if not os.path.exists(f):
                return self.send(404, {"error": "No data yet"})
            body = open(f, "rb").read()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
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
        if self.auth_routes() or not self.authed() or self.limited():
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
        if self.auth_routes() or not self.authed() or self.limited():
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
        if self.auth_routes() or not self.authed() or self.limited(240):
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
            for field, var in (("apify_token", "APIFY_TOKEN"), ("apify_token_meta", "APIFY_TOKEN_META"), ("apify_token_x_linkedin", "APIFY_TOKEN_X_LINKEDIN"),
                               ("apify_token_other", "APIFY_TOKEN_OTHER"), ("youtube_api_key", "YOUTUBE_API_KEY")):
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


def scheduler():
    """Start the daily social collection at the configured time (India time). The fetch itself
    re-checks the time and skips if today's run already happened, so this cannot double-spend."""
    tried = {}
    while True:
        try:
            s = fetch.load_settings()
            loc = now_local(s)
            today = loc.strftime("%Y-%m-%d")
            hh, mm = (s.get("run_after") or "09:00").split(":")
            due = loc.hour * 60 + loc.minute >= int(hh) * 60 + int(mm)
            done = fetch.load_usage().get("last_daily_run") == today
            last_try = tried.get(today, 0)
            if due and not done and not running() and time.time() - last_try > 3600:
                tried = {today: time.time()}
                sys.stderr.write(f"scheduler: starting daily collection {today} {loc:%H:%M}\n")
                with open(LOG_FILE, "a") as logf:
                    subprocess.Popen(SCHEDULED_CMD, stdout=logf, stderr=logf, start_new_session=True,
                                     env={**os.environ, **read_env()})
        except Exception as e:
            sys.stderr.write(f"scheduler error: {e}\n")
        time.sleep(30)


if __name__ == "__main__":
    migrate_public_data()
    threading.Thread(target=scheduler, daemon=True).start()
    port = int(os.environ.get("SENTIMETER_ADMIN_PORT", "8787"))
    print(f"sentimeter-admin on 127.0.0.1:{port}", file=sys.stderr)
    ThreadingHTTPServer(("127.0.0.1", port), H).serve_forever()
