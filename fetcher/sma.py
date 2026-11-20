"""Social Media Analytics: brands and their connected platform accounts.

LinkedIn (first platform) uses the official Community Management API:
  OAuth 2.0 authorization code flow -> organization pages the user administers ->
  daily page statistics (impressions, clicks, reactions, comments, shares, engagement),
  follower gains and totals, follower demographics, page views, and recent posts with
  their statistics.

Storage (server only, root-readable):
  /var/lib/sentimeter/sma/brands.json            brands and non-secret integration settings
  /var/lib/sentimeter/sma/secrets.json  (0600)   client secrets, access and refresh tokens
  /var/lib/sentimeter/sma/<brand>/linkedin.json  synced LinkedIn data
"""
import hashlib, html, json, os, re, secrets, shutil, sys, threading, time, urllib.error, urllib.parse, urllib.request
from datetime import datetime, timedelta, timezone

BASE = os.environ.get("SENTIMETER_SMA_DIR", "/var/lib/sentimeter/sma")
LI_AUTH = os.environ.get("SENTIMETER_LI_AUTH_BASE", "https://www.linkedin.com/oauth/v2")
LI_API = os.environ.get("SENTIMETER_LI_API_BASE", "https://api.linkedin.com/rest")
PUBLIC_URL = os.environ.get("SENTIMETER_PUBLIC_URL", "https://sentimeter.starkpeople.in").rstrip("/")
REDIRECT_PATH = "/api/sma/linkedin/callback"
DEFAULT_SCOPES = "r_organization_social rw_organization_admin"
LOCK = threading.Lock()
STATES = {}          # OAuth state -> {brand, email, exp}
SYNCING = set()      # brand ids with a sync running
PLATFORMS = ["linkedin", "facebook", "instagram", "x", "youtube"]


def log(*a):
    print(datetime.now().strftime("%H:%M:%S"), "sma:", *a, file=sys.stderr)


def now_ms():
    return int(time.time() * 1000)


def iso(ts=None):
    return datetime.fromtimestamp(ts if ts is not None else time.time(), timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def redirect_uri():
    return PUBLIC_URL + REDIRECT_PATH


def default_version():
    """LinkedIn versions are YYYYMM and stay supported for about a year; use the one from two months ago."""
    d = datetime.now(timezone.utc).replace(day=1) - timedelta(days=45)
    return d.strftime("%Y%m")


# ---------------- storage ----------------

def _p(*parts):
    return os.path.join(BASE, *parts)


def _load(path, default):
    try:
        return json.load(open(path))
    except Exception:
        return default


def _save(path, data, mode=0o600):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, mode), "w") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
    os.replace(tmp, path)


def brands():
    return _load(_p("brands.json"), {"brands": []})["brands"]


def save_brands(bs):
    _save(_p("brands.json"), {"brands": bs})


def get_brand(bid):
    return next((b for b in brands() if b["id"] == bid), None)


def update_brand_record(bid, fn):
    with LOCK:
        bs = brands()
        for b in bs:
            if b["id"] == bid:
                fn(b)
        save_brands(bs)


def secrets_all():
    return _load(_p("secrets.json"), {})


def secret(bid, key):
    return secrets_all().get(bid, {}).get(key)


def set_secrets(bid, **kv):
    with LOCK:
        s = secrets_all()
        cur = s.setdefault(bid, {})
        for k, v in kv.items():
            if v is None:
                cur.pop(k, None)
            else:
                cur[k] = v
        _save(_p("secrets.json"), s)


def li_data(bid):
    return _load(_p(bid, "linkedin.json"), {})


def save_li_data(bid, data):
    _save(_p(bid, "linkedin.json"), data, 0o640)


# ---------------- shared helpers: post history, thumbnails, logos ----------------

def merge_posts(old, new, keep_days=400, key="id", date_field="published"):
    """Keep every post seen in the last keep_days; newer statistics replace older ones."""
    cut = iso(time.time() - keep_days * 86400)
    by = {p[key]: p for p in (old or []) if p.get(key)}
    for p in new or []:
        if p.get(key):
            prev = by.get(p[key], {})
            by[p[key]] = {**prev, **{k: v for k, v in p.items() if v is not None}}
    out = [p for p in by.values() if (p.get(date_field) or "") >= cut]
    return sorted(out, key=lambda p: p.get(date_field) or "", reverse=True)


def thumb_name(platform, pid):
    return f"{platform}_{hashlib.sha1(str(pid).encode()).hexdigest()[:16]}.img"


def thumb_path(bid, name):
    if not re.fullmatch(r"[a-z]+_[0-9a-f]{16}\.img", name or ""):
        return None
    return _p(bid, "thumbs", name)


def cache_thumb(bid, platform, pid, url):
    """Download a post image once and keep it (platform image links expire). Returns the stored name."""
    if not url or not str(url).startswith("http"):
        return None
    name = thumb_name(platform, pid)
    path = _p(bid, "thumbs", name)
    if os.path.exists(path):
        return name
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Sentimeter/1.0"})
        with urllib.request.urlopen(req, timeout=20) as r:
            ctype = r.headers.get("Content-Type", "")
            body = r.read(2_500_001)
        if not ctype.startswith("image/") or len(body) > 2_500_000 or len(body) < 100:
            return None
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "wb") as f:
            f.write(body)
        return name
    except Exception:
        return None


LOGO_MAGIC = {b"RIFF": "image/webp", b"\x89PNG": "image/png", b"\xff\xd8\xff": "image/jpeg"}


def save_logo(bid, data_url):
    import base64
    m = re.fullmatch(r"data:image/(png|webp|jpeg);base64,([A-Za-z0-9+/=]+)", str(data_url or ""))
    if not m:
        raise ValueError("Upload a PNG, JPG, WebP or SVG image.")
    raw = base64.b64decode(m.group(2))
    if len(raw) > 300_000 or not any(raw.startswith(k) for k in LOGO_MAGIC):
        raise ValueError("The logo image is too large or not a valid image.")
    path = _p(bid, "logo.img")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as f:
        f.write(raw)
    update_brand_record(bid, lambda r: r.update({"logo": iso()}))


def logo_bytes(bid):
    try:
        raw = open(_p(bid, "logo.img"), "rb").read()
    except FileNotFoundError:
        return None, None
    ctype = next((v for k, v in LOGO_MAGIC.items() if raw.startswith(k)), "application/octet-stream")
    return raw, ctype


def delete_logo(bid):
    try:
        os.remove(_p(bid, "logo.img"))
    except FileNotFoundError:
        pass
    update_brand_record(bid, lambda r: r.update({"logo": None}))


# ---------------- brands (public view never contains secrets) ----------------

def public_brand(b, with_counts=True):
    li = dict(b.get("linkedin") or {})
    sec = secrets_all().get(b["id"], {})
    li["has_client_secret"] = bool(sec.get("li_client_secret"))
    li["connected"] = bool(sec.get("li_access_token"))
    li["refreshable"] = bool(sec.get("li_refresh_token"))
    li["syncing"] = b["id"] in SYNCING
    li["redirect_uri"] = redirect_uri()
    li.setdefault("scopes", DEFAULT_SCOPES)
    li.setdefault("version", "")
    li["default_version"] = default_version()
    out = {"id": b["id"], "name": b["name"], "created": b.get("created"), "logo": b.get("logo"), "linkedin": li}
    if with_counts and li["connected"]:
        d = li_data(b["id"])
        out["linkedin_summary"] = summary(d, 30)
    return out


def create_brand(name):
    name = str(name or "").strip()[:80]
    if not name:
        raise ValueError("Give the brand a name.")
    bid = "b" + secrets.token_hex(4)
    with LOCK:
        bs = brands()
        if len(bs) >= 50:
            raise ValueError("Up to 50 brands.")
        bs.append({"id": bid, "name": name, "created": iso(), "linkedin": {}})
        save_brands(bs)
    return get_brand(bid)


def update_brand(bid, body):
    if not get_brand(bid):
        raise KeyError("Brand not found")
    li = body.get("linkedin") or {}
    errors, changes = [], {}
    if "client_id" in li:
        v = str(li["client_id"]).strip()
        if v and not re.fullmatch(r"[A-Za-z0-9]{6,40}", v):
            errors.append("LinkedIn Client ID looks wrong: use letters and digits only, as shown in the app's Auth tab.")
        changes["client_id"] = v
    if "scopes" in li:
        v = " ".join(str(li["scopes"]).replace(",", " ").split())
        if v and not re.fullmatch(r"[a-z_ ]{3,300}", v):
            errors.append("Scopes: lowercase scope names separated by spaces.")
        changes["scopes"] = v or DEFAULT_SCOPES
    if "version" in li:
        v = str(li["version"]).strip()
        if v and not re.fullmatch(r"20\d{4}", v):
            errors.append("LinkedIn API version is YYYYMM, for example 202609.")
        changes["version"] = v
    sec = str(li.get("client_secret") or "").strip()
    if sec and not re.fullmatch(r"[A-Za-z0-9_.=+\-/]{8,200}", sec):
        errors.append("LinkedIn Client Secret has unexpected characters.")
    if errors:
        raise ValueError(" ".join(errors))

    def apply(rec):
        n = str(body.get("name", "")).strip()[:80]
        if n:
            rec["name"] = n
        rec.setdefault("linkedin", {}).update(changes)
    update_brand_record(bid, apply)
    if sec:
        set_secrets(bid, li_client_secret=sec)
    return get_brand(bid)


def delete_brand(bid):
    with LOCK:
        save_brands([b for b in brands() if b["id"] != bid])
        s = secrets_all()
        s.pop(bid, None)
        _save(_p("secrets.json"), s)
    shutil.rmtree(_p(bid), ignore_errors=True)


# ---------------- LinkedIn OAuth ----------------

def li_start(bid, email):
    b = get_brand(bid)
    if not b:
        raise KeyError("Brand not found")
    li = b.get("linkedin") or {}
    if not li.get("client_id") or not secret(bid, "li_client_secret"):
        raise ValueError("Save the LinkedIn Client ID and Client Secret first.")
    state = secrets.token_urlsafe(24)
    now = time.time()
    for k in [k for k, v in STATES.items() if v["exp"] < now]:
        STATES.pop(k, None)
    STATES[state] = {"brand": bid, "email": email, "exp": now + 600}
    q = urllib.parse.urlencode({"response_type": "code", "client_id": li["client_id"], "redirect_uri": redirect_uri(),
                                "state": state, "scope": li.get("scopes") or DEFAULT_SCOPES})
    return f"{LI_AUTH}/authorization?{q}"


def friendly_li_error(msg):
    """Turn LinkedIn's OAuth errors into plain instructions."""
    msg = html.unescape(str(msg or "")).strip()
    m = re.search(r'[Ss]cope "?([a-z_]+)"? is not authorized', msg)
    if m:
        return (f"LinkedIn has not granted this app the {m.group(1)} permission yet. That permission comes with the "
                "Community Management API: request it in the app's Products tab, wait for LinkedIn's approval, check that the "
                "scope appears under OAuth 2.0 scopes in the Auth tab, then click Connect LinkedIn again.")
    if "redirect_uri" in msg.lower():
        return ("LinkedIn rejected the redirect URL. In the app's Auth tab, add exactly: " + redirect_uri())
    if "user_cancelled" in msg.lower() or "user cancelled" in msg.lower():
        return "The LinkedIn sign-in was cancelled. Click Connect LinkedIn to try again."
    if "client" in msg.lower() and ("invalid" in msg.lower() or "not found" in msg.lower()):
        return "LinkedIn did not recognise the Client ID or Client Secret. Copy both again from the app's Auth tab and save."
    return "LinkedIn: " + msg


def _token_request(form):
    data = urllib.parse.urlencode(form).encode()
    req = urllib.request.Request(f"{LI_AUTH}/accessToken", data=data, headers={"Content-Type": "application/x-www-form-urlencoded"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        body = e.read().decode(errors="replace")[:300]
        try:
            j = json.loads(body)
            body = j.get("error_description") or j.get("message") or body
        except Exception:
            pass
        raise RuntimeError(friendly_li_error(body))


def _store_tokens(bid, tok):
    now = time.time()
    set_secrets(bid, li_access_token=tok["access_token"], li_refresh_token=tok.get("refresh_token") or secret(bid, "li_refresh_token"))
    update_brand_record(bid, lambda b: b.setdefault("linkedin", {}).update({
        "token_expires": iso(now + int(tok.get("expires_in") or 0)),
        "refresh_expires": iso(now + int(tok["refresh_token_expires_in"])) if tok.get("refresh_token_expires_in") else (b.get("linkedin") or {}).get("refresh_expires"),
        "granted_scopes": tok.get("scope") or (b.get("linkedin") or {}).get("granted_scopes", ""),
    }))


def li_callback(params, email):
    """Returns (brand_id, error_message_or_None)."""
    state = params.get("state", "")
    st = STATES.pop(state, None)
    if not st or st["exp"] < time.time():
        return None, "The LinkedIn sign-in expired or was started elsewhere. Click Connect LinkedIn again."
    bid = st["brand"]
    if params.get("error"):
        msg = friendly_li_error(params.get("error_description") or params["error"])
        update_brand_record(bid, lambda b: b.setdefault("linkedin", {}).update({"last_error": msg}))
        return bid, msg
    b = get_brand(bid)
    try:
        tok = _token_request({"grant_type": "authorization_code", "code": params.get("code", ""), "redirect_uri": redirect_uri(),
                              "client_id": b["linkedin"]["client_id"], "client_secret": secret(bid, "li_client_secret")})
        _store_tokens(bid, tok)
        update_brand_record(bid, lambda r: r["linkedin"].update({"connected_at": iso(), "connected_by": email, "last_error": ""}))
        orgs = li_list_orgs(bid)
        update_brand_record(bid, lambda r: r["linkedin"].update({"orgs": orgs}))
        if len(orgs) == 1 or (orgs and not (get_brand(bid)["linkedin"].get("org_urn") in [o["urn"] for o in orgs])):
            if len(orgs) == 1:
                choose_org(bid, orgs[0]["urn"])
        if not orgs:
            update_brand_record(bid, lambda r: r["linkedin"].update({"last_error": "Connected, but this LinkedIn user is not an approved administrator of any company page."}))
        return bid, None
    except Exception as e:
        update_brand_record(bid, lambda r: r.setdefault("linkedin", {}).update({"last_error": str(e)[:300]}))
        return bid, str(e)


def li_refresh_if_needed(bid):
    b = get_brand(bid)
    li = (b or {}).get("linkedin") or {}
    exp = li.get("token_expires")
    if not exp:
        return
    left = datetime.strptime(exp, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc) - datetime.now(timezone.utc)
    if left > timedelta(days=7):
        return
    rt = secret(bid, "li_refresh_token")
    if not rt:
        if left < timedelta(0):
            raise RuntimeError("The LinkedIn connection expired. Click Connect LinkedIn again in Settings.")
        return
    tok = _token_request({"grant_type": "refresh_token", "refresh_token": rt, "client_id": li["client_id"],
                          "client_secret": secret(bid, "li_client_secret")})
    _store_tokens(bid, tok)
    log(f"{bid}: LinkedIn token refreshed")


def disconnect(bid):
    set_secrets(bid, li_access_token=None, li_refresh_token=None)
    update_brand_record(bid, lambda b: b.setdefault("linkedin", {}).update(
        {"token_expires": None, "refresh_expires": None, "connected_at": None, "connected_by": None, "granted_scopes": "", "orgs": []}))


# ---------------- LinkedIn API ----------------

def li_get(bid, path_and_query):
    b = get_brand(bid)
    li = b.get("linkedin") or {}
    tok = secret(bid, "li_access_token")
    if not tok:
        raise RuntimeError("LinkedIn is not connected for this brand.")
    req = urllib.request.Request(f"{LI_API}/{path_and_query}", headers={
        "Authorization": f"Bearer {tok}", "LinkedIn-Version": li.get("version") or default_version(),
        "X-Restli-Protocol-Version": "2.0.0", "Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=40) as r:
            return json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        body = e.read().decode(errors="replace")[:400]
        try:
            j = json.loads(body)
            body = j.get("message") or body
        except Exception:
            pass
        if e.code == 401:
            raise RuntimeError("LinkedIn says the connection is no longer valid. Click Connect LinkedIn again in Settings.")
        if e.code == 403:
            raise RuntimeError(f"LinkedIn denied access ({body}). The app needs the Community Management API and the user must be a page admin.")
        if e.code == 426 or "version" in body.lower():
            raise RuntimeError(f"LinkedIn API version problem ({body}). Set a newer version (YYYYMM) in Settings.")
        raise RuntimeError(f"LinkedIn API error {e.code}: {body}")


def enc(urn):
    return urllib.parse.quote(urn, safe="")


def li_list_orgs(bid):
    j = li_get(bid, "organizationAcls?q=roleAssignee&role=ADMINISTRATOR&state=APPROVED&count=100")
    orgs = []
    for el in j.get("elements", []):
        urn = el.get("organization") or el.get("organizationTarget") or ""
        if not urn.startswith("urn:li:organization:"):
            continue
        oid = urn.rsplit(":", 1)[-1]
        name, vanity = urn, ""
        try:
            o = li_get(bid, f"organizations/{oid}")
            name = o.get("localizedName") or name
            vanity = o.get("vanityName") or ""
        except Exception as e:
            log(f"{bid}: organization {oid} details failed: {e}")
        orgs.append({"urn": urn, "id": oid, "name": name, "vanity": vanity})
    return orgs


def choose_org(bid, urn):
    b = get_brand(bid)
    orgs = (b.get("linkedin") or {}).get("orgs") or []
    o = next((o for o in orgs if o["urn"] == urn), None)
    if not o:
        raise ValueError("That page is not in the list of pages you administer.")
    old = (b.get("linkedin") or {}).get("org_urn")
    update_brand_record(bid, lambda r: r["linkedin"].update({"org_urn": o["urn"], "org_name": o["name"], "org_vanity": o.get("vanity", "")}))
    if old and old != urn:
        save_li_data(bid, {})
    return o


def _ti(start_ms, end_ms):
    return f"(timeRange:(start:{start_ms},end:{end_ms}),timeGranularityType:DAY)"


def _day(ms):
    return datetime.fromtimestamp(int(ms) / 1000, timezone.utc).strftime("%Y-%m-%d")


def _n(v):
    try:
        return float(v or 0)
    except Exception:
        return 0.0


def li_sync(bid, full=False):
    """Pull LinkedIn page statistics into linkedin.json. Returns a short summary dict."""
    if bid in SYNCING:
        raise RuntimeError("A sync for this brand is already running.")
    SYNCING.add(bid)
    started = time.time()
    try:
        li_refresh_if_needed(bid)
        b = get_brand(bid)
        li = b.get("linkedin") or {}
        urn = li.get("org_urn")
        if not urn:
            raise RuntimeError("Choose which LinkedIn page this brand uses (Settings).")
        oid = urn.rsplit(":", 1)[-1]
        data = li_data(bid) or {}
        if data.get("org_urn") != urn:
            data = {"org_urn": urn, "daily": {}}
        daily = data.setdefault("daily", {})
        errors = []
        end = int(datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0).timestamp() * 1000)
        days = 364 if (full or not daily) else 35
        start = end - days * 86400000

        def day_rec(d):
            return daily.setdefault(d, {})

        # 1. daily share statistics
        try:
            j = li_get(bid, f"organizationalEntityShareStatistics?q=organizationalEntity&organizationalEntity={enc(urn)}&timeIntervals={_ti(start, end)}")
            for el in j.get("elements", []):
                d = _day((el.get("timeRange") or {}).get("start", 0))
                s = el.get("totalShareStatistics") or {}
                day_rec(d).update({"impressions": _n(s.get("impressionCount")), "unique_impressions": _n(s.get("uniqueImpressionsCount")),
                                   "clicks": _n(s.get("clickCount")), "reactions": _n(s.get("likeCount")), "comments": _n(s.get("commentCount")),
                                   "shares": _n(s.get("shareCount"))})
        except Exception as e:
            errors.append(f"Post statistics: {e}")
        # 2. daily follower gains
        try:
            j = li_get(bid, f"organizationalEntityFollowerStatistics?q=organizationalEntity&organizationalEntity={enc(urn)}&timeIntervals={_ti(start, end)}")
            for el in j.get("elements", []):
                d = _day((el.get("timeRange") or {}).get("start", 0))
                g = el.get("followerGains") or {}
                day_rec(d).update({"followers_organic": _n(g.get("organicFollowerGain")), "followers_paid": _n(g.get("paidFollowerGain"))})
        except Exception as e:
            errors.append(f"Follower gains: {e}")
        # 3. daily page views
        try:
            j = li_get(bid, f"organizationPageStatistics?q=organization&organization={enc(urn)}&timeIntervals={_ti(start, end)}")
            for el in j.get("elements", []):
                d = _day((el.get("timeRange") or {}).get("start", 0))
                v = ((el.get("totalPageStatistics") or {}).get("views") or {})
                day_rec(d).update({"page_views": _n((v.get("allPageViews") or {}).get("pageViews")),
                                   "unique_page_views": _n((v.get("allPageViews") or {}).get("uniquePageViews"))})
        except Exception as e:
            errors.append(f"Page views: {e}")
        # 4. total followers
        try:
            j = li_get(bid, f"networkSizes/{enc(urn)}?edgeType=COMPANY_FOLLOWED_BY_MEMBER")
            data["followers_total"] = int(j.get("firstDegreeSize") or 0)
            hist = data.setdefault("followers_history", {})
            hist[datetime.now(timezone.utc).strftime("%Y-%m-%d")] = data["followers_total"]
        except Exception as e:
            errors.append(f"Follower total: {e}")
        # 5. follower demographics (lifetime)
        try:
            j = li_get(bid, f"organizationalEntityFollowerStatistics?q=organizationalEntity&organizationalEntity={enc(urn)}")
            el = (j.get("elements") or [{}])[0]

            def facet(key, field):
                rows = []
                for r in el.get(key, []) or []:
                    fc = r.get("followerCounts") or {}
                    rows.append({"urn": r.get(field, ""), "count": int(_n(fc.get("organicFollowerCount")) + _n(fc.get("paidFollowerCount")))})
                return sorted(rows, key=lambda r: -r["count"])[:25]
            data["demographics"] = {"function": facet("followerCountsByFunction", "function"), "seniority": facet("followerCountsBySeniority", "seniority"),
                                    "industry": facet("followerCountsByIndustry", "industry"), "country": facet("followerCountsByGeoCountry", "geo"),
                                    "company_size": facet("followerCountsByStaffCountRange", "staffCountRange")}
        except Exception as e:
            errors.append(f"Demographics: {e}")
        # 6. recent posts and their statistics
        try:
            j = li_get(bid, f"posts?q=author&author={enc(urn)}&count=50&sortBy=LAST_MODIFIED")
            posts = []
            for p in j.get("elements", []):
                pid = p.get("id", "")
                text = p.get("commentary") or ((p.get("content") or {}).get("article") or {}).get("title") or ""
                posts.append({"id": pid, "text": text[:1200], "published": iso(_n(p.get("publishedAt") or p.get("createdAt")) / 1000),
                              "url": f"https://www.linkedin.com/feed/update/{pid}/", "state": p.get("lifecycleState", "")})
            stats = {}
            shares = [p["id"] for p in posts if p["id"].startswith("urn:li:share:")]
            ugcs = [p["id"] for p in posts if p["id"].startswith("urn:li:ugcPost:")]
            for kind, ids in (("shares", shares), ("ugcPosts", ugcs)):
                for i in range(0, len(ids), 20):
                    chunk = ids[i:i + 20]
                    q = f"organizationalEntityShareStatistics?q=organizationalEntity&organizationalEntity={enc(urn)}&{kind}=List({','.join(enc(x) for x in chunk)})"
                    for el in li_get(bid, q).get("elements", []):
                        key = el.get("share") or el.get("ugcPost")
                        stats[key] = el.get("totalShareStatistics") or {}
            for p in posts:
                s = stats.get(p["id"], {})
                p.update({"impressions": _n(s.get("impressionCount")), "unique_impressions": _n(s.get("uniqueImpressionsCount")),
                          "clicks": _n(s.get("clickCount")), "reactions": _n(s.get("likeCount")), "comments": _n(s.get("commentCount")),
                          "shares": _n(s.get("shareCount")), "engagement": _n(s.get("engagement"))})
            data["posts"] = merge_posts(data.get("posts"), posts)
        except Exception as e:
            errors.append(f"Posts: {e}")

        data["org_urn"] = urn
        data["org_name"] = li.get("org_name")
        data["synced_at"] = iso()
        hist = data.setdefault("sync_log", [])
        result = {"at": iso(), "ok": not errors, "errors": errors, "days": days, "seconds": round(time.time() - started, 1), "full": days > 35}
        data["sync_log"] = (hist + [result])[-30:]
        save_li_data(bid, data)
        update_brand_record(bid, lambda r: r["linkedin"].update({"last_sync": iso(), "last_sync_date": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
                                                                 "last_error": "; ".join(errors)[:400]}))
        log(f"{bid}: LinkedIn synced in {result['seconds']}s, {len(errors)} errors")
        return result
    except Exception as e:
        update_brand_record(bid, lambda r: r.setdefault("linkedin", {}).update({"last_error": str(e)[:400]}))
        d = li_data(bid) or {}
        d["sync_log"] = (d.get("sync_log", []) + [{"at": iso(), "ok": False, "errors": [str(e)[:300]]}])[-30:]
        save_li_data(bid, d)
        raise
    finally:
        SYNCING.discard(bid)


def sync_async(bid, full=False):
    def run():
        try:
            li_sync(bid, full)
        except Exception as e:
            log(f"{bid}: sync failed: {e}")
    threading.Thread(target=run, daemon=True).start()


def daily_sync_due(today):
    """Start a daily sync for every connected brand not yet synced today."""
    for b in brands():
        li = b.get("linkedin") or {}
        if secret(b["id"], "li_access_token") and li.get("org_urn") and li.get("last_sync_date") != today \
                and li.get("last_attempt_date") != today and b["id"] not in SYNCING:
            update_brand_record(b["id"], lambda r: r["linkedin"].update({"last_attempt_date": today}))
            log(f"{b['id']}: daily LinkedIn sync")
            sync_async(b["id"])


# ---------------- summaries for the brand list ----------------

def summary(d, days):
    daily = d.get("daily") or {}
    keys = sorted(daily)[-days:]
    tot = lambda f: sum(daily[k].get(f, 0) for k in keys)
    imp = tot("impressions")
    eng = tot("clicks") + tot("reactions") + tot("comments") + tot("shares")
    return {"followers": d.get("followers_total"), "followers_gained": tot("followers_organic") + tot("followers_paid"),
            "impressions": imp, "engagement_rate": (eng / imp) if imp else None, "synced_at": d.get("synced_at"), "days": len(keys)}
