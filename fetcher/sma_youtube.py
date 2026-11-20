"""Social Media Analytics: YouTube channels via the YouTube Analytics API v2 and YouTube Data API v3.

Flow: Google OAuth (authorization code, offline access) -> access token (1 hour) + refresh token
-> channels?mine=true gives the channel chosen at sign-in (Brand Accounts are picked in Google's
account chooser) -> daily channel reports, audience breakdowns, top videos and recent uploads.

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
SCOPES = "https://www.googleapis.com/auth/youtube.readonly https://www.googleapis.com/auth/yt-analytics.readonly"
STATES = {}
DAILY_METRICS = ["views", "estimatedMinutesWatched", "averageViewDuration", "averageViewPercentage", "subscribersGained",
                 "subscribersLost", "likes", "comments", "shares"]
FIELD = {"views": "views", "estimatedMinutesWatched": "watch_minutes", "averageViewDuration": "avg_view_duration",
         "averageViewPercentage": "avg_view_pct", "subscribersGained": "subs_gained", "subscribersLost": "subs_lost",
         "likes": "likes", "comments": "comments", "shares": "shares"}


def key(bid):
    return "youtube:" + bid


def redirect_uri():
    return sma.PUBLIC_URL + REDIRECT_PATH


def data(bid):
    return sma._load(sma._p(bid, "youtube.json"), {})


def save_data(bid, d):
    sma._save(sma._p(bid, "youtube.json"), d, 0o640)


def cfg(b):
    return (b or {}).get("youtube") or {}


def public(b):
    y = dict(cfg(b))
    sec = sma.secrets_all().get(b["id"], {})
    y["has_client_secret"] = bool(sec.get("yt_client_secret"))
    y["connected"] = bool(sec.get("yt_refresh_token") or sec.get("yt_access_token"))
    y["refreshable"] = bool(sec.get("yt_refresh_token"))
    y["syncing"] = key(b["id"]) in sma.SYNCING
    y["redirect_uri"] = redirect_uri()
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
    if "client_id" in y:
        v = str(y["client_id"]).strip()
        if v and not re.fullmatch(r"[0-9]{6,20}-[a-z0-9]{10,64}\.apps\.googleusercontent\.com", v):
            errors.append("Google Client ID looks like 123456789012-abc...xyz.apps.googleusercontent.com (Credentials > OAuth 2.0 Client IDs).")
        changes["client_id"] = v
    sec = str(y.get("client_secret") or "").strip()
    if sec and not re.fullmatch(r"[A-Za-z0-9_\-]{20,80}", sec):
        errors.append("Google Client Secret has unexpected characters (it usually starts with GOCSPX-).")
    if errors:
        raise ValueError(" ".join(errors))
    sma.update_brand_record(bid, lambda r: r.setdefault("youtube", {}).update(changes))
    if sec:
        sma.set_secrets(bid, yt_client_secret=sec)


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
    if not y.get("client_id") or not sma.secret(bid, "yt_client_secret"):
        raise ValueError("Save the Google Client ID and Client Secret first.")
    state = pysecrets.token_urlsafe(24)
    now = time.time()
    for k in [k for k, v in STATES.items() if v["exp"] < now]:
        STATES.pop(k, None)
    STATES[state] = {"brand": bid, "email": email, "exp": now + 600}
    q = urllib.parse.urlencode({"client_id": y["client_id"], "redirect_uri": redirect_uri(), "response_type": "code", "scope": SCOPES,
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


def _store(bid, tok):
    kv = {"yt_access_token": tok["access_token"], "yt_access_expires": time.time() + int(tok.get("expires_in") or 3600) - 60}
    if tok.get("refresh_token"):
        kv["yt_refresh_token"] = tok["refresh_token"]
    sma.set_secrets(bid, **kv)
    if tok.get("scope"):
        sma.update_brand_record(bid, lambda r: r.setdefault("youtube", {}).update({"granted_scopes": tok["scope"]}))


def access_token(bid):
    sec = sma.secrets_all().get(bid, {})
    if sec.get("yt_access_token") and sec.get("yt_access_expires", 0) > time.time():
        return sec["yt_access_token"]
    if not sec.get("yt_refresh_token"):
        raise RuntimeError("The YouTube connection expired. Click Connect YouTube again in Settings.")
    y = cfg(sma.get_brand(bid))
    tok = _token_post({"grant_type": "refresh_token", "refresh_token": sec["yt_refresh_token"], "client_id": y["client_id"],
                       "client_secret": sec.get("yt_client_secret", "")})
    _store(bid, tok)
    return tok["access_token"]


def api(bid, url, params):
    tok = access_token(bid)
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
        return None, "The Google sign-in expired or was started elsewhere. Click Connect YouTube again."
    bid = st["brand"]
    if params.get("error"):
        msg = friendly(params.get("error_description") or params["error"])
        sma.update_brand_record(bid, lambda r: r.setdefault("youtube", {}).update({"last_error": msg}))
        return bid, msg
    y = cfg(sma.get_brand(bid))
    try:
        tok = _token_post({"grant_type": "authorization_code", "code": params.get("code", ""), "redirect_uri": redirect_uri(),
                           "client_id": y["client_id"], "client_secret": sma.secret(bid, "yt_client_secret")})
        _store(bid, tok)
        if not tok.get("refresh_token") and not sma.secret(bid, "yt_refresh_token"):
            sma.update_brand_record(bid, lambda r: r.setdefault("youtube", {}).update({"last_error":
                "Google did not issue a long-lived token, so the connection will stop after an hour. Remove Sentimeter's access at "
                "myaccount.google.com/permissions, then click Connect YouTube again."}))
        ch = api(bid, f"{DATA_API}/channels", {"part": "snippet,statistics,contentDetails", "mine": "true"})
        items = ch.get("items") or []
        if not items:
            msg = ("Connected, but this Google account has no YouTube channel. Click Connect YouTube again and, in Google's account "
                   "chooser, pick the channel's account or Brand Account.")
            sma.update_brand_record(bid, lambda r: r.setdefault("youtube", {}).update({"last_error": msg, "connected_at": sma.iso(), "connected_by": email}))
            return bid, msg
        c = items[0]
        old = cfg(sma.get_brand(bid)).get("channel_id")
        sma.update_brand_record(bid, lambda r: r.setdefault("youtube", {}).update({
            "connected_at": sma.iso(), "connected_by": email, "last_error": "", "channel_id": c["id"],
            "channel_title": (c.get("snippet") or {}).get("title", ""), "channel_handle": (c.get("snippet") or {}).get("customUrl", "")}))
        if old and old != c["id"]:
            save_data(bid, {})
        return bid, None
    except Exception as e:
        sma.update_brand_record(bid, lambda r: r.setdefault("youtube", {}).update({"last_error": str(e)[:400]}))
        return bid, str(e)


def disconnect(bid):
    sma.set_secrets(bid, yt_access_token=None, yt_refresh_token=None, yt_access_expires=None)
    sma.update_brand_record(bid, lambda r: r.setdefault("youtube", {}).update(
        {"connected_at": None, "connected_by": None, "granted_scopes": ""}))


# ---------------- sync ----------------

def _report(bid, start, end, metrics, dimensions=None, sort=None, max_results=None, filters=None):
    p = {"ids": "channel==MINE", "startDate": start, "endDate": end, "metrics": ",".join(metrics)}
    if dimensions:
        p["dimensions"] = dimensions
    if sort:
        p["sort"] = sort
    if max_results:
        p["maxResults"] = max_results
    if filters:
        p["filters"] = filters
    j = api(bid, f"{ANALYTICS}/reports", p)
    cols = [c["name"] for c in j.get("columnHeaders", [])]
    return [dict(zip(cols, row)) for row in j.get("rows", []) or []]


def _n(v):
    try:
        return float(v or 0)
    except Exception:
        return 0.0


def _videos(bid, ids):
    out = {}
    for i in range(0, len(ids), 50):
        j = api(bid, f"{DATA_API}/videos", {"part": "snippet,statistics,contentDetails", "id": ",".join(ids[i:i + 50])})
        for v in j.get("items", []):
            s, st = v.get("snippet") or {}, v.get("statistics") or {}
            out[v["id"]] = {"id": v["id"], "title": s.get("title", ""), "published": (s.get("publishedAt") or "")[:19] + "Z",
                            "url": f"https://www.youtube.com/watch?v={v['id']}", "duration": (v.get("contentDetails") or {}).get("duration", ""),
                            "total_views": _n(st.get("viewCount")), "total_likes": _n(st.get("likeCount")), "total_comments": _n(st.get("commentCount"))}
    return out


def sync(bid, full=False):
    k = key(bid)
    if k in sma.SYNCING:
        raise RuntimeError("A YouTube sync for this brand is already running.")
    sma.SYNCING.add(k)
    t0 = time.time()
    try:
        y = cfg(sma.get_brand(bid))
        if not y.get("channel_id"):
            raise RuntimeError("Connect a YouTube channel first (Settings).")
        d = data(bid) or {}
        if d.get("channel_id") != y["channel_id"]:
            d = {"channel_id": y["channel_id"]}
        notes, errors = [], []
        today = datetime.now(timezone.utc).date()
        end = today.isoformat()
        days = 365 if (full or not d.get("daily")) else 35
        start = (today - timedelta(days=days)).isoformat()

        try:
            ch = api(bid, f"{DATA_API}/channels", {"part": "snippet,statistics,contentDetails", "id": y["channel_id"]})
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
            rows = _report(bid, start, end, metrics, "day", "day")
        except Exception as e:
            notes.append(f"Some daily metrics unavailable ({str(e)[:160]})")
            metrics = ["views", "estimatedMinutesWatched", "subscribersGained", "subscribersLost"]
            try:
                rows = _report(bid, start, end, metrics, "day", "day")
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
                breakdowns[name] = _report(bid, a90, end, mets, dims, srt, mx)
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
                rows = _report(bid, (today - timedelta(days=n)).isoformat(), end,
                               ["views", "estimatedMinutesWatched", "likes", "comments", "shares", "subscribersGained"], "video", "-views", 25)
                top[label] = rows
            except Exception as e:
                notes.append(f"Top videos ({n} days) unavailable ({str(e)[:140]})")
        ids = sorted({r["video"] for rows in top.values() for r in rows})
        info = {}
        try:
            info = _videos(bid, ids) if ids else {}
        except Exception as e:
            notes.append(f"Video titles unavailable ({str(e)[:140]})")
        d["top_videos"] = {lbl: [dict(info.get(r["video"], {"id": r["video"], "title": r["video"], "url": f"https://www.youtube.com/watch?v={r['video']}"}),
                                     views=_n(r.get("views")), watch_minutes=_n(r.get("estimatedMinutesWatched")), likes=_n(r.get("likes")),
                                     comments=_n(r.get("comments")), shares=_n(r.get("shares")), subs_gained=_n(r.get("subscribersGained")))
                                for r in rows] for lbl, rows in top.items()}

        try:
            up = (d.get("channel") or {}).get("uploads")
            if up:
                j = api(bid, f"{DATA_API}/playlistItems", {"part": "contentDetails", "playlistId": up, "maxResults": 25})
                vids = [it["contentDetails"]["videoId"] for it in j.get("items", [])]
                vinfo = _videos(bid, vids) if vids else {}
                d["uploads"] = [vinfo[v] for v in vids if v in vinfo]
        except Exception as e:
            notes.append(f"Recent uploads unavailable ({str(e)[:140]})")

        d["channel_id"] = y["channel_id"]
        d["synced_at"] = sma.iso()
        d["notes"] = notes[:30]
        res = {"at": sma.iso(), "ok": not errors, "errors": errors, "notes": len(notes), "days": days, "full": days > 35,
               "seconds": round(time.time() - t0, 1)}
        d["sync_log"] = (d.get("sync_log", []) + [res])[-30:]
        save_data(bid, d)
        sma.update_brand_record(bid, lambda r: r.setdefault("youtube", {}).update({"last_sync": sma.iso(), "last_sync_date": today.isoformat(),
                                                                                    "last_error": "; ".join(errors)[:400]}))
        sma.log(f"{bid}: YouTube synced in {res['seconds']}s, {len(errors)} errors, {len(notes)} notes")
        return res
    except Exception as e:
        sma.update_brand_record(bid, lambda r: r.setdefault("youtube", {}).update({"last_error": str(e)[:400]}))
        dd = data(bid) or {}
        dd["sync_log"] = (dd.get("sync_log", []) + [{"at": sma.iso(), "ok": False, "errors": [str(e)[:300]]}])[-30:]
        save_data(bid, dd)
        raise
    finally:
        sma.SYNCING.discard(k)


def sync_async(bid, full=False):
    def run():
        try:
            sync(bid, full)
        except Exception as e:
            sma.log(f"{bid}: YouTube sync failed: {e}")
    threading.Thread(target=run, daemon=True).start()


def daily_due(today):
    for b in sma.brands():
        y = cfg(b)
        if sma.secret(b["id"], "yt_refresh_token") and y.get("channel_id") and y.get("last_sync_date") != today \
                and y.get("last_attempt_date") != today and key(b["id"]) not in sma.SYNCING:
            sma.update_brand_record(b["id"], lambda r: r["youtube"].update({"last_attempt_date": today}))
            sync_async(b["id"])
