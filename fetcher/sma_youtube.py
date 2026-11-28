"""Social Media Analytics: YouTube channels via the YouTube Analytics API v2 and YouTube Data API v3.

Flow: Google OAuth (authorization code, offline access) -> access token (1 hour) + refresh token
-> channels?mine=true gives the channel chosen at sign-in (Brand Accounts are picked in Google's
account chooser) -> daily channel reports, audience breakdowns, top videos and recent uploads.

A brand can have several channels: each Google sign-in adds the channel picked in Google's chooser,
with its own tokens (secrets["yt_channels"][channel_id]) and data file (youtube_<channel_id>.json).
One channel is "active" for the report; every channel syncs daily.

Analytics data runs about two days behind; days YouTube has not reported yet are simply absent.
Each optional report is requested on its own, so one unsupported report shows as unavailable
instead of failing the sync.

Data: /var/lib/sentimeter/sma/<brand>/youtube.json. Secrets (client secret, access and refresh
tokens) live in secrets.json (mode 600) and never leave the server.
"""
import html, json, os, re, secrets as pysecrets, threading, time, urllib.error, urllib.parse, urllib.request
from datetime import datetime, timedelta, timezone

import sma

AUTH = os.environ.get("SENTIMETER_GOOGLE_AUTH_URL", "https://accounts.google.com/o/oauth2/v2/auth")
TOKEN = os.environ.get("SENTIMETER_GOOGLE_TOKEN_URL", "https://oauth2.googleapis.com/token")
DATA_API = os.environ.get("SENTIMETER_YT_DATA_BASE", "https://www.googleapis.com/youtube/v3").rstrip("/")
ANALYTICS = os.environ.get("SENTIMETER_YT_ANALYTICS_BASE", "https://youtubeanalytics.googleapis.com/v2").rstrip("/")
REDIRECT_PATH = "/api/sma/youtube/callback"
UPLOAD_API = os.environ.get("SENTIMETER_YT_UPLOAD_BASE", "https://www.googleapis.com/upload/youtube/v3").rstrip("/")
UPLOAD_SCOPE = "https://www.googleapis.com/auth/youtube.upload"
SCOPES = "https://www.googleapis.com/auth/youtube.readonly https://www.googleapis.com/auth/yt-analytics.readonly " + UPLOAD_SCOPE
STATES = {}
DAILY_METRICS = ["views", "estimatedMinutesWatched", "averageViewDuration", "averageViewPercentage", "subscribersGained",
                 "subscribersLost", "likes", "comments", "shares"]
FIELD = {"views": "views", "estimatedMinutesWatched": "watch_minutes", "averageViewDuration": "avg_view_duration",
         "averageViewPercentage": "avg_view_pct", "subscribersGained": "subs_gained", "subscribersLost": "subs_lost",
         "likes": "likes", "comments": "comments", "shares": "shares"}


def key(bid, cid=""):
    return f"youtube:{bid}:{cid}"


def busy(bid):
    return any(k.startswith(f"youtube:{bid}:") for k in sma.SYNCING)


def redirect_uri():
    return sma.PUBLIC_URL + REDIRECT_PATH


def cfg(b):
    return (b or {}).get("youtube") or {}


def channels(b):
    return cfg(b).get("channels") or []


def active(b):
    y = cfg(b)
    ids = [c["id"] for c in channels(b)]
    return y.get("channel_id") if y.get("channel_id") in ids else (ids[0] if ids else None)


def tokens(bid):
    return (sma.secrets_all().get(bid, {}) or {}).get("yt_channels") or {}


def set_tokens(bid, cid, **kv):
    with sma.LOCK:
        s = sma.secrets_all()
        ch = s.setdefault(bid, {}).setdefault("yt_channels", {})
        cur = ch.setdefault(cid, {})
        for k, v in kv.items():
            if v is None:
                cur.pop(k, None)
            else:
                cur[k] = v
        if not cur:
            ch.pop(cid, None)
        sma._save(sma._p("secrets.json"), s)


def drop_tokens(bid, cid):
    with sma.LOCK:
        s = sma.secrets_all()
        (s.get(bid, {}).get("yt_channels") or {}).pop(cid, None)
        sma._save(sma._p("secrets.json"), s)


def _path(bid, cid):
    return sma._p(bid, f"youtube_{re.sub(r'[^A-Za-z0-9_-]', '', cid or '')}.json")


def data(bid, cid=None):
    cid = cid or active(sma.get_brand(bid))
    return sma._load(_path(bid, cid), {}) if cid else {}


def save_data(bid, cid, d):
    sma._save(_path(bid, cid), d, 0o640)


def migrate(bid):
    """Move a single-channel connection (before multi-channel support) into the per-channel layout."""
    b = sma.get_brand(bid)
    y = cfg(b)
    sec = sma.secrets_all().get(bid, {})
    cid = y.get("channel_id")
    if cid and not channels(b):
        if sec.get("yt_refresh_token") or sec.get("yt_access_token"):
            set_tokens(bid, cid, refresh=sec.get("yt_refresh_token"), access=sec.get("yt_access_token"), expires=sec.get("yt_access_expires"))
        sma.set_secrets(bid, yt_refresh_token=None, yt_access_token=None, yt_access_expires=None)
        entry = {"id": cid, "title": y.get("channel_title", ""), "handle": y.get("channel_handle", ""), "connected_by": y.get("connected_by"),
                 "connected_at": y.get("connected_at"), "granted_scopes": y.get("granted_scopes", ""), "last_sync": y.get("last_sync"),
                 "last_sync_date": y.get("last_sync_date"), "last_error": y.get("last_error", "")}
        sma.update_brand_record(bid, lambda r: r["youtube"].update({"channels": [entry]}))
        old = sma._p(bid, "youtube.json")
        if os.path.exists(old) and not os.path.exists(_path(bid, cid)):
            os.replace(old, _path(bid, cid))


def update_channel(bid, cid, **kv):
    def fn(r):
        for c in r.setdefault("youtube", {}).setdefault("channels", []):
            if c["id"] == cid:
                c.update(kv)
    sma.update_brand_record(bid, fn)


def public(b):
    migrate(b["id"])
    b = sma.get_brand(b["id"])
    y = dict(cfg(b))
    sec = sma.secrets_all().get(b["id"], {})
    tk = tokens(b["id"])
    chs = []
    for c in channels(b):
        c = dict(c)
        c["connected"] = bool((tk.get(c["id"]) or {}).get("refresh") or (tk.get(c["id"]) or {}).get("access"))
        c["refreshable"] = bool((tk.get(c["id"]) or {}).get("refresh"))
        c["syncing"] = key(b["id"], c["id"]) in sma.SYNCING
        chs.append(c)
    act = active(b)
    a = next((c for c in chs if c["id"] == act), {})
    y.update({"channels": chs, "channel_id": act, "channel_title": a.get("title", ""), "channel_handle": a.get("handle", ""),
              "connected": bool(a.get("connected")), "refreshable": bool(a.get("refreshable")), "connected_by": a.get("connected_by"),
              "connected_at": a.get("connected_at"), "granted_scopes": a.get("granted_scopes", ""), "last_sync": a.get("last_sync"),
              "channel_error": a.get("last_error", ""), "has_client_secret": bool(sma.app_secret("youtube")),
              "syncing": busy(b["id"]), "redirect_uri": redirect_uri()})
    y["last_error"] = y.get("last_error") or a.get("last_error", "")
    y["client_id"] = sma.app_id("youtube")
    legacy = cfg(b).get("client_id", "")
    for c in chs:
        c["app_mismatch"] = sma.app_mismatch("youtube", {"connected_app_id": c.get("connected_app_id") or legacy}, c.get("connected"))
    y["app_mismatch"] = any(c["app_mismatch"] for c in chs)
    y["can_post"] = bool(a.get("connected")) and UPLOAD_SCOPE in str(a.get("granted_scopes") or "").split()
    return y


def summary(d, days=30):
    daily = d.get("daily") or {}
    ks = sorted(daily)[-days:]
    if not d.get("channel"):
        return None
    tot = lambda f: sum((daily[k].get(f) or 0) for k in ks)
    return {"subscribers": d["channel"].get("subscribers"), "views": tot("views"), "watch_hours": tot("watch_minutes") / 60,
            "net_subscribers": tot("subs_gained") - tot("subs_lost"), "synced_at": d.get("synced_at")}


def update(bid, body):
    y = body.get("youtube")
    if not y:
        return
    errors, changes = [], {}
    if "client_id" in y or y.get("client_secret"):   # older clients: these now set the shared app
        sma.set_app("youtube", y.get("client_id"), y.get("client_secret"))


def friendly(msg):
    msg = html.unescape(str(msg or "")).strip()
    low = msg.lower()
    if "redirect_uri_mismatch" in low or "redirect uri" in low:
        return "Google rejected the redirect URL. In the OAuth client's Authorized redirect URIs, add exactly: " + redirect_uri()
    if "access_denied" in low:
        return ("Google sign-in was cancelled or blocked. If the app's publishing status is Testing, add the channel's Google account "
                "as a test user (Google Auth Platform > Audience), then click Connect YouTube again.")
    if "invalid_client" in low or "unauthorized_client" in low:
        return "Google did not recognise the Client ID or Client Secret. Copy both again from the OAuth client and save."
    if "invalid_grant" in low:
        return ("Google ended the YouTube connection. Apps in Testing mode lose access after 7 days; publish the app (or make it Internal) "
                "and click Connect YouTube again.")
    if "has not been used" in low or "is disabled" in low or "accessnotconfigured" in low:
        return "Turn on both the YouTube Data API v3 and the YouTube Analytics API in the Google Cloud project, then sync again. (" + msg[:160] + ")"
    if "insufficient" in low and "scope" in low or "forbidden" in low and "permission" in low:
        return "Google did not grant the YouTube permissions. Click Connect YouTube again and allow all requested access."
    return "Google: " + msg


def start(bid, email):
    b = sma.get_brand(bid)
    if not b:
        raise KeyError("Brand not found")
    y = cfg(b)
    if not sma.app_id("youtube") or not sma.app_secret("youtube"):
        raise ValueError("Save the workspace Google app (Client ID and Secret) under Workspace > Platform apps first.")
    state = pysecrets.token_urlsafe(24)
    now = time.time()
    for k in [k for k, v in STATES.items() if v["exp"] < now]:
        STATES.pop(k, None)
    STATES[state] = {"brand": bid, "email": email, "exp": now + 600}
    q = urllib.parse.urlencode({"client_id": sma.app_id("youtube"), "redirect_uri": redirect_uri(), "response_type": "code", "scope": SCOPES,
                                "access_type": "offline", "prompt": "consent select_account", "include_granted_scopes": "true", "state": state})
    return f"{AUTH}?{q}"


def _token_post(form):
    req = urllib.request.Request(TOKEN, data=urllib.parse.urlencode(form).encode(), headers={"Content-Type": "application/x-www-form-urlencoded"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        body = e.read().decode(errors="replace")[:400]
        try:
            j = json.loads(body)
            body = f"{j.get('error', '')} {j.get('error_description', '')}".strip() or body
        except Exception:
            pass
        raise RuntimeError(friendly(body))


def access_token(bid, cid):
    tk = tokens(bid).get(cid) or {}
    if tk.get("access") and (tk.get("expires") or 0) > time.time():
        return tk["access"]
    if not tk.get("refresh"):
        raise RuntimeError("The YouTube connection for this channel expired. Click Add or reconnect channel in Settings.")
    tok = _token_post({"grant_type": "refresh_token", "refresh_token": tk["refresh"], "client_id": sma.app_id("youtube"),
                       "client_secret": sma.app_secret("youtube") or ""})
    set_tokens(bid, cid, access=tok["access_token"], expires=time.time() + int(tok.get("expires_in") or 3600) - 60)
    return tok["access_token"]


def api(bid, url, params, cid=None, token=None):
    tok = token or access_token(bid, cid)
    req = urllib.request.Request(f"{url}?{urllib.parse.urlencode(params)}", headers={"Authorization": f"Bearer {tok}", "Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=40) as r:
            return json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        body = e.read().decode(errors="replace")[:500]
        try:
            err = json.loads(body).get("error") or {}
            body = err.get("message") or body
            reason = ((err.get("errors") or [{}])[0]).get("reason", "")
            if reason:
                body = f"{body} ({reason})"
        except Exception:
            pass
        raise RuntimeError(friendly(body))


def callback(params, email):
    st = STATES.pop(params.get("state", ""), None)
    if not st or st["exp"] < time.time():
        return None, None, "The Google sign-in expired or was started elsewhere. Click Connect YouTube again."
    bid = st["brand"]
    migrate(bid)
    if params.get("error"):
        msg = friendly(params.get("error_description") or params["error"])
        sma.update_brand_record(bid, lambda r: r.setdefault("youtube", {}).update({"last_error": msg}))
        return bid, None, msg
    y = cfg(sma.get_brand(bid))
    try:
        tok = _token_post({"grant_type": "authorization_code", "code": params.get("code", ""), "redirect_uri": redirect_uri(),
                           "client_id": sma.app_id("youtube"), "client_secret": sma.app_secret("youtube")})
        ch = api(bid, f"{DATA_API}/channels", {"part": "snippet,statistics,contentDetails", "mine": "true"}, token=tok["access_token"])
        items = ch.get("items") or []
        if not items:
            msg = ("This Google account has no YouTube channel. Click Add another channel and, in Google's account chooser, pick the "
                   "channel's account or Brand Account.")
            sma.update_brand_record(bid, lambda r: r.setdefault("youtube", {}).update({"last_error": msg}))
            return bid, None, msg
        c = items[0]
        cid = c["id"]
        prev = tokens(bid).get(cid) or {}
        set_tokens(bid, cid, access=tok["access_token"], expires=time.time() + int(tok.get("expires_in") or 3600) - 60,
                   refresh=tok.get("refresh_token") or prev.get("refresh"))
        entry = {"id": cid, "title": (c.get("snippet") or {}).get("title", ""), "handle": (c.get("snippet") or {}).get("customUrl", ""),
                 "connected_by": email, "connected_at": sma.iso(), "granted_scopes": tok.get("scope", ""), "last_error": "",
                 "connected_app_id": sma.app_id("youtube")}
        if not tok.get("refresh_token") and not prev.get("refresh"):
            entry["last_error"] = ("Google did not issue a long-lived token, so this channel will stop after an hour. Remove Sentimeter at "
                                   "myaccount.google.com/permissions, then add the channel again.")

        def fn(r):
            y2 = r.setdefault("youtube", {})
            chs = [x for x in y2.get("channels", []) if x["id"] != cid]
            old = next((x for x in y2.get("channels", []) if x["id"] == cid), {})
            chs.append({**{k: old.get(k) for k in ("last_sync", "last_sync_date")}, **entry})
            y2.update({"channels": chs, "channel_id": cid, "last_error": ""})
        sma.update_brand_record(bid, fn)
        return bid, cid, None
    except Exception as e:
        sma.update_brand_record(bid, lambda r: r.setdefault("youtube", {}).update({"last_error": str(e)[:400]}))
        return bid, None, str(e)


def select(bid, cid):
    if cid not in [c["id"] for c in channels(sma.get_brand(bid))]:
        raise ValueError("That channel is not connected to this brand.")
    sma.update_brand_record(bid, lambda r: r["youtube"].update({"channel_id": cid}))


def remove(bid, cid):
    drop_tokens(bid, cid)
    sma.update_brand_record(bid, lambda r: r.setdefault("youtube", {}).update(
        {"channels": [c for c in r["youtube"].get("channels", []) if c["id"] != cid]}))
    try:
        os.remove(_path(bid, cid))
    except FileNotFoundError:
        pass
    b = sma.get_brand(bid)
    if cfg(b).get("channel_id") == cid:
        sma.update_brand_record(bid, lambda r: r["youtube"].update({"channel_id": (channels(b) or [{}])[0].get("id")}))


def disconnect(bid):
    for c in channels(sma.get_brand(bid)):
        remove(bid, c["id"])


# ---------------- sync ----------------

def _report(bid, cid, start, end, metrics, dimensions=None, sort=None, max_results=None, filters=None):
    p = {"ids": "channel==MINE", "startDate": start, "endDate": end, "metrics": ",".join(metrics)}
    if dimensions:
        p["dimensions"] = dimensions
    if sort:
        p["sort"] = sort
    if max_results:
        p["maxResults"] = max_results
    if filters:
        p["filters"] = filters
    j = api(bid, f"{ANALYTICS}/reports", p, cid)
    cols = [c["name"] for c in j.get("columnHeaders", [])]
    return [dict(zip(cols, row)) for row in j.get("rows", []) or []]


def _n(v):
    try:
        return float(v or 0)
    except Exception:
        return 0.0


def _videos(bid, cid, ids):
    out = {}
    for i in range(0, len(ids), 50):
        j = api(bid, f"{DATA_API}/videos", {"part": "snippet,statistics,contentDetails", "id": ",".join(ids[i:i + 50])}, cid)
        for v in j.get("items", []):
            s, st = v.get("snippet") or {}, v.get("statistics") or {}
            out[v["id"]] = {"id": v["id"], "title": s.get("title", ""), "description": (s.get("description") or "")[:2000], "published": (s.get("publishedAt") or "")[:19] + "Z",
                            "url": f"https://www.youtube.com/watch?v={v['id']}", "duration": (v.get("contentDetails") or {}).get("duration", ""),
                            "picture": ((s.get("thumbnails") or {}).get("medium") or (s.get("thumbnails") or {}).get("default") or {}).get("url", ""),
                            "total_views": _n(st.get("viewCount")), "total_likes": _n(st.get("likeCount")), "total_comments": _n(st.get("commentCount"))}
    return out


def sync(bid, full=False, cid=None):
    migrate(bid)
    cid = cid or active(sma.get_brand(bid))
    if not cid:
        raise RuntimeError("Connect a YouTube channel first (Settings).")
    k = key(bid, cid)
    if k in sma.SYNCING:
        raise RuntimeError("A YouTube sync for this brand is already running.")
    sma.SYNCING.add(k)
    t0 = time.time()
    try:
        d = data(bid, cid) or {}
        d["channel_id"] = cid
        notes, errors = [], []
        today = datetime.now(timezone.utc).date()
        end = today.isoformat()
        days = 365 if (full or not d.get("daily")) else 35
        start = (today - timedelta(days=days)).isoformat()

        try:
            ch = api(bid, f"{DATA_API}/channels", {"part": "snippet,statistics,contentDetails", "id": cid}, cid)
            c = (ch.get("items") or [{}])[0]
            s, st = c.get("snippet") or {}, c.get("statistics") or {}
            d["channel"] = {"id": c.get("id"), "title": s.get("title"), "handle": s.get("customUrl", ""),
                            "subscribers": None if st.get("hiddenSubscriberCount") else _n(st.get("subscriberCount")),
                            "views": _n(st.get("viewCount")), "videos": _n(st.get("videoCount")),
                            "uploads": ((c.get("contentDetails") or {}).get("relatedPlaylists") or {}).get("uploads", "")}
        except Exception as e:
            errors.append(f"Channel: {e}")

        daily = d.setdefault("daily", {})
        metrics = list(DAILY_METRICS)
        try:
            rows = _report(bid, cid, start, end, metrics, "day", "day")
        except Exception as e:
            notes.append(f"Some daily metrics unavailable ({str(e)[:160]})")
            metrics = ["views", "estimatedMinutesWatched", "subscribersGained", "subscribersLost"]
            try:
                rows = _report(bid, cid, start, end, metrics, "day", "day")
            except Exception as e2:
                errors.append(f"Daily statistics: {e2}")
                rows = []
        for r in rows:
            rec = daily.setdefault(r["day"], {})
            for m in metrics:
                if m in r:
                    rec[FIELD[m]] = _n(r[m])

        a90 = (today - timedelta(days=90)).isoformat()
        breakdowns = {}
        for name, dims, mets, srt, mx in (
                ("traffic", "insightTrafficSourceType", ["views", "estimatedMinutesWatched"], "-views", None),
                ("countries", "country", ["views", "estimatedMinutesWatched"], "-views", 15),
                ("devices", "deviceType", ["views", "estimatedMinutesWatched"], "-views", None),
                ("content_types", "creatorContentType", ["views", "estimatedMinutesWatched"], "-views", None),
                ("age_gender", "ageGroup,gender", ["viewerPercentage"], None, None)):
            try:
                breakdowns[name] = _report(bid, cid, a90, end, mets, dims, srt, mx)
            except Exception as e:
                label = {"traffic": "Traffic sources", "countries": "Countries", "devices": "Devices",
                         "content_types": "Format (videos, Shorts, live)", "age_gender": "Age and gender"}[name]
                notes.append(f"{label} unavailable ({str(e)[:140]})")
        if breakdowns:
            d["breakdowns"] = breakdowns
            d["breakdowns_period"] = [a90, end]

        top = {}
        for label, n in (("d28", 28), ("d90", 90), ("d365", 365)):
            try:
                rows = _report(bid, cid, (today - timedelta(days=n)).isoformat(), end,
                               ["views", "estimatedMinutesWatched", "likes", "comments", "shares", "subscribersGained"], "video", "-views", 25)
                top[label] = rows
            except Exception as e:
                notes.append(f"Top videos ({n} days) unavailable ({str(e)[:140]})")
        ids = sorted({r["video"] for rows in top.values() for r in rows})
        info = {}
        try:
            info = _videos(bid, cid, ids) if ids else {}
        except Exception as e:
            notes.append(f"Video titles unavailable ({str(e)[:140]})")
        d["top_videos"] = {lbl: [dict(info.get(r["video"], {"id": r["video"], "title": r["video"], "url": f"https://www.youtube.com/watch?v={r['video']}"}),
                                     views=_n(r.get("views")), watch_minutes=_n(r.get("estimatedMinutesWatched")), likes=_n(r.get("likes")),
                                     comments=_n(r.get("comments")), shares=_n(r.get("shares")), subs_gained=_n(r.get("subscribersGained")))
                                for r in rows] for lbl, rows in top.items()}

        try:
            up = (d.get("channel") or {}).get("uploads")
            if up:
                j = api(bid, f"{DATA_API}/playlistItems", {"part": "contentDetails", "playlistId": up, "maxResults": 50}, cid)
                vids = [it["contentDetails"]["videoId"] for it in j.get("items", [])]
                vinfo = _videos(bid, cid, vids) if vids else {}
                ups = []
                for v in vids:
                    if v in vinfo:
                        x = dict(vinfo[v])
                        x["thumb"] = sma.cache_thumb(bid, "yt", v, x.get("picture", "")) or None
                        ups.append(x)
                d["uploads"] = sma.merge_posts(d.get("uploads"), ups)
        except Exception as e:
            notes.append(f"Recent uploads unavailable ({str(e)[:140]})")

        d["synced_at"] = sma.iso()
        d["notes"] = notes[:30]
        res = {"at": sma.iso(), "ok": not errors, "errors": errors, "notes": len(notes), "days": days, "full": days > 35,
               "seconds": round(time.time() - t0, 1)}
        d["sync_log"] = (d.get("sync_log", []) + [res])[-30:]
        save_data(bid, cid, d)
        update_channel(bid, cid, last_sync=sma.iso(), last_sync_date=today.isoformat(), last_error="; ".join(errors)[:400])
        sma.log(f"{bid}: YouTube synced in {res['seconds']}s, {len(errors)} errors, {len(notes)} notes")
        return res
    except Exception as e:
        update_channel(bid, cid, last_error=str(e)[:400])
        dd = data(bid, cid) or {}
        dd["sync_log"] = (dd.get("sync_log", []) + [{"at": sma.iso(), "ok": False, "errors": [str(e)[:300]]}])[-30:]
        save_data(bid, cid, dd)
        raise
    finally:
        sma.SYNCING.discard(k)


def sync_async(bid, full=False, cid=None):
    def run():
        try:
            sync(bid, full, cid)
        except Exception as e:
            sma.log(f"{bid}: YouTube sync failed: {e}")
    threading.Thread(target=run, daemon=True).start()


def daily_due(today):
    for b in sma.brands():
        migrate(b["id"])
        b = sma.get_brand(b["id"])
        tk = tokens(b["id"])
        for c in channels(b):
            if (tk.get(c["id"]) or {}).get("refresh") and c.get("last_sync_date") != today and c.get("last_attempt_date") != today \
                    and key(b["id"], c["id"]) not in sma.SYNCING:
                update_channel(b["id"], c["id"], last_attempt_date=today)
                sync_async(b["id"], cid=c["id"])


# ---------------- publishing (videos.insert, resumable upload) ----------------

def publish(bid, title, description, video_path, ctype="video/mp4", privacy="public", tags=None):
    """Upload a video to the brand's active channel. Returns (video_id, url).
    Videos from Google Cloud projects that have not passed YouTube's API audit are locked to private by YouTube."""
    b = sma.get_brand(bid)
    cid = active(b)
    if not cid:
        raise RuntimeError("No YouTube channel is connected for this brand.")
    tok = access_token(bid, cid)
    meta = {"snippet": {"title": (title or "Untitled")[:100], "description": (description or "")[:5000], "categoryId": "19"},
            "status": {"privacyStatus": privacy if privacy in ("public", "unlisted", "private") else "public", "selfDeclaredMadeForKids": False}}
    if tags:
        meta["snippet"]["tags"] = tags[:30]
    size = os.path.getsize(video_path)
    req = urllib.request.Request(f"{UPLOAD_API}/videos?uploadType=resumable&part=snippet,status", data=json.dumps(meta).encode(), method="POST",
                                 headers={"Authorization": f"Bearer {tok}", "Content-Type": "application/json; charset=UTF-8",
                                          "X-Upload-Content-Type": ctype, "X-Upload-Content-Length": str(size)})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            loc = r.headers.get("Location")
    except urllib.error.HTTPError as e:
        raise RuntimeError(_yt_err(e))
    if not loc:
        raise RuntimeError("YouTube did not start the upload.")
    with open(video_path, "rb") as f:
        up = urllib.request.Request(loc, data=f, method="PUT", headers={"Content-Type": ctype, "Content-Length": str(size)})
        try:
            with urllib.request.urlopen(up, timeout=1800) as r:
                v = json.loads(r.read() or b"{}")
        except urllib.error.HTTPError as e:
            raise RuntimeError(_yt_err(e))
    vid = v.get("id")
    if not vid:
        raise RuntimeError("YouTube did not confirm the upload.")
    return vid, f"https://youtu.be/{vid}"


def _yt_err(e):
    body = e.read().decode(errors="replace")[:4000]
    try:
        err = json.loads(body).get("error") or {}
        reason = ((err.get("errors") or [{}])[0]).get("reason", "")
        body = (err.get("message") or body[:300]) + (f" ({reason})" if reason else "")
    except Exception:
        body = body[:300]
    low = body.lower()
    if "quota" in low:
        return "YouTube's daily API quota is used up (each upload costs about 1,600 of the 10,000 daily units). Try again tomorrow."
    if "uploadlimitexceeded" in low:
        return "This YouTube channel has reached its upload limit for now. Try again later."
    if "insufficient" in low or "forbidden" in low and "scope" in low:
        return "This channel was connected without upload permission. Click Add or reconnect channel in Brand settings and allow all access."
    return friendly(body)
