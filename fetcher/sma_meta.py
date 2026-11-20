"""Social Media Analytics: Facebook Pages and Instagram professional accounts via the Meta Graph API.

Flow: Facebook Login (authorization code) -> short-lived user token -> long-lived user token (~60 days)
-> /me/accounts lists the Pages the user manages, each with a Page token (does not expire when
derived from a long-lived user token) and its linked Instagram professional account.

Meta renames and retires insight metrics from time to time (for example impressions -> views).
Every metric is requested on its own, with the newer name first and the older one as a fallback,
so a retired metric shows as unavailable instead of failing the whole sync.

Data: /var/lib/sentimeter/sma/<brand>/meta.json. Secrets (app secret, user token, page token)
live in secrets.json (mode 600) and never leave the server.
"""
import hashlib, hmac, html, json, os, re, secrets as pysecrets, sys, threading, time, urllib.error, urllib.parse, urllib.request
from datetime import datetime, timedelta, timezone

import sma

DIALOG = os.environ.get("SENTIMETER_FB_DIALOG_BASE", "https://www.facebook.com").rstrip("/")
GRAPH = os.environ.get("SENTIMETER_FB_GRAPH_BASE", "https://graph.facebook.com").rstrip("/")
REDIRECT_PATH = "/api/sma/meta/callback"
DEFAULT_VERSION = "v23.0"
DEFAULT_SCOPES = ("pages_show_list pages_read_engagement read_insights business_management "
                  "instagram_basic instagram_manage_insights")
STATES = {}


def key(bid):
    return "meta:" + bid


def redirect_uri():
    return sma.PUBLIC_URL + REDIRECT_PATH


def data(bid):
    return sma._load(sma._p(bid, "meta.json"), {})


def save_data(bid, d):
    sma._save(sma._p(bid, "meta.json"), d, 0o640)


def cfg(b):
    return (b or {}).get("meta") or {}


def version(b):
    return cfg(b).get("version") or DEFAULT_VERSION


# ---------------- public view (no secrets) ----------------

def public(b):
    m = dict(cfg(b))
    sec = sma.secrets_all().get(b["id"], {})
    m["has_app_secret"] = bool(sec.get("fb_app_secret"))
    m["connected"] = bool(sec.get("fb_user_token") or sec.get("fb_page_token"))
    m["page_connected"] = bool(sec.get("fb_page_token")) and bool(m.get("page_id"))
    m["syncing"] = key(b["id"]) in sma.SYNCING
    m["redirect_uri"] = redirect_uri()
    m.setdefault("scopes", DEFAULT_SCOPES)
    m.setdefault("version", "")
    m["default_version"] = DEFAULT_VERSION
    return m


def summary(d, days=30):
    out = {}
    fb = d.get("fb_daily") or {}
    ks = sorted(fb)[-days:]
    if d.get("page"):
        tot = lambda f: sum((fb[k].get(f) or 0) for k in ks)
        reach = tot("reach")
        out["facebook"] = {"followers": d["page"].get("followers"), "views": tot("views"), "reach": reach,
                           "engagements": tot("engagements"), "engagement_rate": (tot("engagements") / reach) if reach else None}
    ig = d.get("ig_daily") or {}
    ks = sorted(ig)[-days:]
    if d.get("ig"):
        tot = lambda f: sum((ig[k].get(f) or 0) for k in ks)
        reach = tot("reach")
        out["instagram"] = {"followers": d["ig"].get("followers"), "views": tot("views"), "reach": reach,
                            "interactions": tot("interactions"), "engagement_rate": (tot("interactions") / reach) if reach else None}
    out["synced_at"] = d.get("synced_at")
    return out


def update(bid, body):
    m = body.get("meta")
    if not m:
        return
    errors, changes = [], {}
    if "app_id" in m:
        v = str(m["app_id"]).strip()
        if v and not re.fullmatch(r"\d{6,20}", v):
            errors.append("Meta App ID is a number, shown at the top of the app dashboard.")
        changes["app_id"] = v
    if "scopes" in m:
        v = " ".join(str(m["scopes"]).replace(",", " ").split())
        if v and not re.fullmatch(r"[a-z_ ]{3,500}", v):
            errors.append("Permissions: lowercase names separated by spaces.")
        changes["scopes"] = v or DEFAULT_SCOPES
    if "version" in m:
        v = str(m["version"]).strip()
        if v and not re.fullmatch(r"v\d{2}\.\d", v):
            errors.append("Graph API version looks like v23.0.")
        changes["version"] = v
    sec = str(m.get("app_secret") or "").strip()
    if sec and not re.fullmatch(r"[a-f0-9]{32}", sec):
        errors.append("Meta App Secret is 32 letters and digits (a-f, 0-9), from App settings > Basic.")
    if errors:
        raise ValueError(" ".join(errors))
    sma.update_brand_record(bid, lambda r: r.setdefault("meta", {}).update(changes))
    if sec:
        sma.set_secrets(bid, fb_app_secret=sec)


# ---------------- OAuth ----------------

def friendly(msg):
    msg = html.unescape(str(msg or "")).strip()
    low = msg.lower()
    if "redirect_uri" in low or "url blocked" in low or "redirect uri" in low:
        return ("Meta rejected the redirect URL. In the app, under Facebook Login > Settings > Valid OAuth Redirect URIs, add exactly: "
                + redirect_uri())
    if "invalid scope" in low or "invalid scopes" in low:
        return ("Meta does not recognise one of the permissions. Check that the app has the Facebook Login for Business and "
                "Instagram products, or remove the permission named in this message: " + msg)
    if "app not active" in low or "not available" in low and "app" in low:
        return "The Meta app is not active for this account. Add the person as an app admin or developer, or switch the app to Live."
    if "user denied" in low or "access_denied" in low or "permissions error" in low and "denied" in low:
        return "The Facebook sign-in was cancelled or permissions were declined. Click Connect again and allow all requested access."
    if "client secret" in low or "validating client secret" in low or "invalid client_id" in low or "invalid app id" in low:
        return "Meta did not recognise the App ID or App Secret. Copy both again from App settings > Basic and save."
    if "session has expired" in low or "error validating access token" in low:
        return "The Facebook connection expired or was revoked. Click Connect Facebook & Instagram again."
    return "Meta: " + msg


def start(bid, email):
    b = sma.get_brand(bid)
    if not b:
        raise KeyError("Brand not found")
    m = cfg(b)
    if not m.get("app_id") or not sma.secret(bid, "fb_app_secret"):
        raise ValueError("Save the Meta App ID and App Secret first.")
    state = pysecrets.token_urlsafe(24)
    now = time.time()
    for k in [k for k, v in STATES.items() if v["exp"] < now]:
        STATES.pop(k, None)
    STATES[state] = {"brand": bid, "email": email, "exp": now + 600}
    q = urllib.parse.urlencode({"client_id": m["app_id"], "redirect_uri": redirect_uri(), "state": state, "response_type": "code",
                                "scope": ",".join((m.get("scopes") or DEFAULT_SCOPES).split())})
    return f"{DIALOG}/{version(b)}/dialog/oauth?{q}"


def _proof(bid, token):
    sec = sma.secret(bid, "fb_app_secret") or ""
    return hmac.new(sec.encode(), token.encode(), hashlib.sha256).hexdigest()


def graph(bid, path, params=None, token=None, b=None):
    b = b or sma.get_brand(bid)
    params = dict(params or {})
    tok = token if token is not None else (sma.secret(bid, "fb_page_token") or sma.secret(bid, "fb_user_token"))
    if tok:
        params["access_token"] = tok
        params["appsecret_proof"] = _proof(bid, tok)
    url = f"{GRAPH}/{version(b)}/{path.lstrip('/')}?{urllib.parse.urlencode(params)}"
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers={"Accept": "application/json"}), timeout=40) as r:
            return json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        body = e.read().decode(errors="replace")[:500]
        try:
            err = json.loads(body).get("error") or {}
            body = err.get("error_user_msg") or err.get("message") or body
        except Exception:
            pass
        raise RuntimeError(friendly(body))


def _token(bid, params):
    b = sma.get_brand(bid)
    j = graph(bid, "oauth/access_token", params, token="", b=b)
    if "access_token" not in j:
        raise RuntimeError(friendly(json.dumps(j)[:300]))
    return j


def callback(params, email):
    st = STATES.pop(params.get("state", ""), None)
    if not st or st["exp"] < time.time():
        return None, "The Facebook sign-in expired or was started elsewhere. Click Connect again."
    bid = st["brand"]
    if params.get("error") or params.get("error_reason"):
        msg = friendly(params.get("error_description") or params.get("error_reason") or params.get("error"))
        sma.update_brand_record(bid, lambda r: r.setdefault("meta", {}).update({"last_error": msg}))
        return bid, msg
    b = sma.get_brand(bid)
    m = cfg(b)
    try:
        app_secret = sma.secret(bid, "fb_app_secret")
        short = _token(bid, {"client_id": m["app_id"], "client_secret": app_secret, "redirect_uri": redirect_uri(), "code": params.get("code", "")})
        long = _token(bid, {"grant_type": "fb_exchange_token", "client_id": m["app_id"], "client_secret": app_secret,
                            "fb_exchange_token": short["access_token"]})
        exp = int(long.get("expires_in") or 60 * 86400)
        sma.set_secrets(bid, fb_user_token=long["access_token"], fb_page_token=None)
        pages = list_pages(bid)
        granted = []
        try:
            perms = graph(bid, "me/permissions", token=long["access_token"])
            granted = [p["permission"] for p in perms.get("data", []) if p.get("status") == "granted"]
        except Exception:
            pass
        sma.update_brand_record(bid, lambda r: r.setdefault("meta", {}).update({
            "connected_at": sma.iso(), "connected_by": email, "user_token_expires": sma.iso(time.time() + exp),
            "granted_scopes": " ".join(granted), "pages": [{k: p[k] for k in ("id", "name", "ig_id", "ig_username")} for p in pages],
            "last_error": "" if pages else "Connected, but this Facebook account does not manage any Pages the app can see. "
                                           "During sign-in, choose the Pages (and Business) to share with the app."}))
        cur = cfg(sma.get_brand(bid)).get("page_id")
        if len(pages) == 1 or any(p["id"] == cur for p in pages):
            choose_page(bid, cur if any(p["id"] == cur for p in pages) else pages[0]["id"], pages)
        return bid, None
    except Exception as e:
        sma.update_brand_record(bid, lambda r: r.setdefault("meta", {}).update({"last_error": str(e)[:400]}))
        return bid, str(e)


def list_pages(bid):
    tok = sma.secret(bid, "fb_user_token")
    j = graph(bid, "me/accounts", {"fields": "id,name,access_token,instagram_business_account{id,username}", "limit": 100}, token=tok)
    out = []
    for p in j.get("data", []):
        ig = p.get("instagram_business_account") or {}
        out.append({"id": p["id"], "name": p.get("name", p["id"]), "token": p.get("access_token", ""), "ig_id": ig.get("id", ""),
                    "ig_username": ig.get("username", "")})
    return out


def choose_page(bid, page_id, pages=None):
    pages = pages if pages is not None else list_pages(bid)
    p = next((p for p in pages if p["id"] == page_id), None)
    if not p or not p.get("token"):
        raise ValueError("That Page is not in the list of Pages you manage.")
    old = cfg(sma.get_brand(bid)).get("page_id")
    sma.set_secrets(bid, fb_page_token=p["token"])
    sma.update_brand_record(bid, lambda r: r.setdefault("meta", {}).update(
        {"page_id": p["id"], "page_name": p["name"], "ig_id": p.get("ig_id", ""), "ig_username": p.get("ig_username", "")}))
    if old and old != page_id:
        save_data(bid, {})
    return {k: p[k] for k in ("id", "name", "ig_id", "ig_username")}


def disconnect(bid):
    sma.set_secrets(bid, fb_user_token=None, fb_page_token=None)
    sma.update_brand_record(bid, lambda r: r.setdefault("meta", {}).update(
        {"connected_at": None, "connected_by": None, "user_token_expires": None, "granted_scopes": "", "pages": []}))


# ---------------- sync ----------------

def _end_day(end_time):
    """Insight values carry the end of their day (Pacific midnight); the day they describe is the one before."""
    try:
        t = datetime.strptime(end_time[:19], "%Y-%m-%dT%H:%M:%S").replace(tzinfo=timezone.utc)
    except Exception:
        return None
    return (t - timedelta(days=1)).strftime("%Y-%m-%d")


def _num(v):
    if isinstance(v, dict):
        return sum(_num(x) for x in v.values())
    try:
        return float(v or 0)
    except Exception:
        return 0.0


def _series(bid, obj, metric, since, until, step_days, extra=None):
    """Daily values for one metric between since and until (unix seconds), in windows Meta accepts."""
    out = {}
    s = since
    while s < until:
        e = min(until, s + step_days * 86400)
        j = graph(bid, f"{obj}/insights", dict({"metric": metric, "period": "day", "since": s, "until": e}, **(extra or {})))
        for row in j.get("data", []):
            for v in row.get("values", []):
                d = _end_day(v.get("end_time", ""))
                if d:
                    out[d] = _num(v.get("value"))
        s = e
    return out


def _first_available(bid, obj, names, since, until, step, notes, label):
    """Try metric names in order; return (name, series) for the first Meta accepts."""
    errs = []
    for n in names:
        try:
            return n, _series(bid, obj, n, since, until, step)
        except Exception as e:
            errs.append(f"{n}: {str(e)[:120]}")
    notes.append(f"{label} unavailable ({'; '.join(errs)[:300]})")
    return None, {}


def sync(bid, full=False):
    k = key(bid)
    if k in sma.SYNCING:
        raise RuntimeError("A Facebook/Instagram sync for this brand is already running.")
    sma.SYNCING.add(k)
    t0 = time.time()
    try:
        b = sma.get_brand(bid)
        m = cfg(b)
        page_id, ig_id = m.get("page_id"), m.get("ig_id")
        if not page_id or not sma.secret(bid, "fb_page_token"):
            raise RuntimeError("Choose which Facebook Page this brand uses (Settings).")
        d = data(bid) or {}
        if d.get("page_id") != page_id:
            d = {"page_id": page_id}
        notes, errors = [], []
        now = int(time.time())
        today0 = int(datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0).timestamp())
        fb_days = 364 if (full or not d.get("fb_daily")) else 35
        since = today0 - fb_days * 86400

        # ---- Facebook Page
        try:
            p = graph(bid, page_id, {"fields": "id,name,username,link,followers_count,fan_count,picture{url}"})
            d["page"] = {"id": p.get("id"), "name": p.get("name"), "username": p.get("username", ""), "link": p.get("link", ""),
                         "followers": p.get("followers_count"), "fans": p.get("fan_count")}
        except Exception as e:
            errors.append(f"Facebook Page: {e}")
        fb = d.setdefault("fb_daily", {})
        for field, names, label in (
                ("views", ["page_media_view", "page_impressions"], "Facebook views/impressions"),
                ("reach", ["page_total_media_view_unique", "page_impressions_unique"], "Facebook reach"),
                ("engagements", ["page_post_engagements"], "Facebook engagements"),
                ("follows", ["page_daily_follows_unique", "page_fan_adds_unique"], "Facebook new follows"),
                ("unfollows", ["page_daily_unfollows_unique", "page_fan_removes_unique"], "Facebook unfollows"),
                ("page_views", ["page_views_total"], "Facebook page views"),
                ("video_views", ["page_video_views"], "Facebook video views")):
            name, ser = _first_available(bid, page_id, names, since, today0, 90, notes, label)
            for day, v in ser.items():
                fb.setdefault(day, {})[field] = v
            if name:
                d.setdefault("metric_names", {})[f"fb_{field}"] = name
        try:
            cutoff = sma.iso(time.time() - (400 if fb_days > 35 else 45) * 86400)
            posts, after, pages = [], None, 0
            while pages < 12:
                prm = {"fields": "id,message,created_time,permalink_url,full_picture,shares,reactions.summary(true).limit(0),comments.summary(true).limit(0)", "limit": 50}
                if after:
                    prm["after"] = after
                j = graph(bid, f"{page_id}/posts", prm)
                rows = j.get("data", [])
                for x in rows:
                    posts.append({"id": x["id"], "text": (x.get("message") or "")[:1200], "published": (x.get("created_time") or "")[:19] + "Z",
                                  "url": x.get("permalink_url", ""), "picture": x.get("full_picture", ""),
                                  "reactions": _num(((x.get("reactions") or {}).get("summary") or {}).get("total_count")),
                                  "comments": _num(((x.get("comments") or {}).get("summary") or {}).get("total_count")),
                                  "shares": _num((x.get("shares") or {}).get("count")), "views": None, "reach": None})
                after = ((j.get("paging") or {}).get("cursors") or {}).get("after")
                pages += 1
                if not rows or not after or not (j.get("paging") or {}).get("next") or posts[-1]["published"] < cutoff:
                    break
            recent_cut = sma.iso(time.time() - 45 * 86400)
            for x in [p for p in posts if p["published"] >= recent_cut][:80]:
                for fld, names in (("views", ["post_media_view", "post_impressions"]), ("reach", ["post_total_media_view_unique", "post_impressions_unique"])):
                    for n in names:
                        try:
                            r = graph(bid, f"{x['id']}/insights", {"metric": n})
                            vals = ((r.get("data") or [{}])[0].get("values") or [{}])
                            x[fld] = _num(vals[0].get("value")) if vals else None
                            break
                        except Exception:
                            continue
            for x in posts:
                x["thumb"] = sma.cache_thumb(bid, "fb", x["id"], x.pop("picture", "")) or None
            d["fb_posts"] = sma.merge_posts(d.get("fb_posts"), posts)
        except Exception as e:
            errors.append(f"Facebook posts: {e}")

        # ---- Instagram professional account
        if ig_id:
            try:
                a = graph(bid, ig_id, {"fields": "id,username,name,followers_count,follows_count,media_count"})
                d["ig"] = {"id": a.get("id"), "username": a.get("username"), "name": a.get("name"), "followers": a.get("followers_count"),
                           "follows": a.get("follows_count"), "media_count": a.get("media_count")}
            except Exception as e:
                errors.append(f"Instagram account: {e}")
            ig = d.setdefault("ig_daily", {})
            ig_days = 29 if (full or not d.get("ig_daily")) else 3
            for field, metric in (("reach", "reach"), ("followers_gained", "follower_count")):
                try:
                    ser = _series(bid, ig_id, metric, today0 - min(ig_days, 29) * 86400, today0, 29)
                    for day, v in ser.items():
                        ig.setdefault(day, {})[field] = v
                except Exception as e:
                    notes.append(f"Instagram {metric} unavailable ({str(e)[:160]})")
            totals = ["views", "total_interactions", "likes", "comments", "shares", "saves", "profile_views", "accounts_engaged"]
            ok_metrics = list(totals)
            for i in range(ig_days, 0, -1):
                s, e = today0 - i * 86400, today0 - (i - 1) * 86400
                day = datetime.fromtimestamp(s, timezone.utc).strftime("%Y-%m-%d")
                vals = {}
                try:
                    r = graph(bid, f"{ig_id}/insights", {"metric": ",".join(ok_metrics), "period": "day", "metric_type": "total_value", "since": s, "until": e})
                    for row in r.get("data", []):
                        vals[row["name"]] = _num((row.get("total_value") or {}).get("value"))
                except Exception:
                    for mname in list(ok_metrics):
                        try:
                            r = graph(bid, f"{ig_id}/insights", {"metric": mname, "period": "day", "metric_type": "total_value", "since": s, "until": e})
                            for row in r.get("data", []):
                                vals[row["name"]] = _num((row.get("total_value") or {}).get("value"))
                        except Exception as ex:
                            ok_metrics.remove(mname)
                            notes.append(f"Instagram {mname} unavailable ({str(ex)[:120]})")
                rec = ig.setdefault(day, {})
                for src, dst in (("views", "views"), ("total_interactions", "interactions"), ("likes", "likes"), ("comments", "comments"),
                                 ("shares", "shares"), ("saves", "saves"), ("profile_views", "profile_views"), ("accounts_engaged", "accounts_engaged")):
                    if src in vals:
                        rec[dst] = vals[src]
            demo = {}
            for br in ("age", "gender", "country", "city"):
                try:
                    r = graph(bid, f"{ig_id}/insights", {"metric": "follower_demographics", "period": "lifetime", "metric_type": "total_value", "breakdown": br})
                    rows = []
                    for res in (((r.get("data") or [{}])[0].get("total_value") or {}).get("breakdowns") or [{}])[0].get("results", []) or []:
                        rows.append({"label": ", ".join(res.get("dimension_values") or []), "count": _num(res.get("value"))})
                    demo[br] = sorted(rows, key=lambda x: -x["count"])[:15]
                except Exception as e:
                    notes.append(f"Instagram {br} demographics unavailable ({str(e)[:120]})")
            if demo:
                d["ig_demographics"] = demo
            try:
                cutoff = sma.iso(time.time() - (400 if fb_days > 35 else 45) * 86400)
                raw, after, pages = [], None, 0
                while pages < 12:
                    prm = {"fields": "id,caption,media_type,media_product_type,timestamp,permalink,like_count,comments_count,media_url,thumbnail_url", "limit": 50}
                    if after:
                        prm["after"] = after
                    j = graph(bid, f"{ig_id}/media", prm)
                    rows = j.get("data", [])
                    raw += rows
                    after = ((j.get("paging") or {}).get("cursors") or {}).get("after")
                    pages += 1
                    if not rows or not after or not (j.get("paging") or {}).get("next") or (rows[-1].get("timestamp") or "")[:19] + "Z" < cutoff:
                        break
                recent_cut = sma.iso(time.time() - 45 * 86400)
                media = []
                for x in raw:
                    it = {"id": x["id"], "text": (x.get("caption") or "")[:1200], "published": (x.get("timestamp") or "")[:19] + "Z",
                          "url": x.get("permalink", ""), "type": x.get("media_product_type") or x.get("media_type", ""),
                          "likes": _num(x.get("like_count")), "comments": _num(x.get("comments_count")), "reach": None, "views": None, "saves": None, "shares": None,
                          "thumb": sma.cache_thumb(bid, "ig", x["id"], x.get("thumbnail_url") or (x.get("media_url") if x.get("media_type") != "VIDEO" else "")) or None}
                    for mset in (() if it["published"] < recent_cut else ("reach,views,saved,shares,total_interactions", "reach,saved")):
                        try:
                            r = graph(bid, f"{x['id']}/insights", {"metric": mset})
                            for row in r.get("data", []):
                                v = _num(((row.get("values") or [{}])[0]).get("value")) if row.get("values") else _num((row.get("total_value") or {}).get("value"))
                                it[{"saved": "saves"}.get(row["name"], row["name"])] = v
                            break
                        except Exception:
                            continue
                    media.append(it)
                d["ig_media"] = sma.merge_posts(d.get("ig_media"), media)
            except Exception as e:
                errors.append(f"Instagram posts: {e}")
        else:
            d.pop("ig", None)
            notes.append("No Instagram professional account is linked to this Facebook Page.")

        d["page_id"] = page_id
        d["synced_at"] = sma.iso()
        d["notes"] = sorted(set(notes))[:30]
        res = {"at": sma.iso(), "ok": not errors, "errors": errors, "notes": len(notes), "days": fb_days, "full": fb_days > 35,
               "seconds": round(time.time() - t0, 1)}
        d["sync_log"] = (d.get("sync_log", []) + [res])[-30:]
        save_data(bid, d)
        sma.update_brand_record(bid, lambda r: r.setdefault("meta", {}).update({"last_sync": sma.iso(), "last_sync_date": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
                                                                                 "last_error": "; ".join(errors)[:400]}))
        sma.log(f"{bid}: Meta synced in {res['seconds']}s, {len(errors)} errors, {len(notes)} notes")
        return res
    except Exception as e:
        sma.update_brand_record(bid, lambda r: r.setdefault("meta", {}).update({"last_error": str(e)[:400]}))
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
            sma.log(f"{bid}: Meta sync failed: {e}")
    threading.Thread(target=run, daemon=True).start()


def daily_due(today):
    for b in sma.brands():
        m = cfg(b)
        if sma.secret(b["id"], "fb_page_token") and m.get("page_id") and m.get("last_sync_date") != today \
                and m.get("last_attempt_date") != today and key(b["id"]) not in sma.SYNCING:
            sma.update_brand_record(b["id"], lambda r: r["meta"].update({"last_attempt_date": today}))
            sync_async(b["id"])
