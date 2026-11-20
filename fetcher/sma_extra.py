"""Brand report extras: report settings, X (via Apify) and monthly competitor follower counts (via Apify).

Report settings live in the brand record under "report":
  weekly: bool, sections: {handles, x, listening, competitors}, handles: {facebook, instagram, x, linkedin, youtube},
  alert_id: listening alert used for the sentiment slides, competitors: {national: [...], international: [...]}
  where each competitor is {name, facebook, instagram}.
Data files: <brand>/x.json and <brand>/competitors.json.
"""
import json, os, re, threading, time
from datetime import datetime, timezone

import fetch
import sma

ENV_FILE = os.environ.get("SENTIMETER_ENV", "/etc/sentimeter.env")
X_ACTOR = "apidojo~tweet-scraper"
IG_PROFILE_ACTOR = "apify~instagram-profile-scraper"
FB_PAGES_ACTOR = "apify~facebook-pages-scraper"
SECTIONS = ("handles", "x", "listening", "competitors")
HANDLE_KEYS = ("facebook", "instagram", "x", "linkedin", "youtube")
SAMPLE_COMPETITORS = {
    "national": ["Madhya Pradesh Tourism", "Incredible India Tourism", "Gujarat Tourism", "Uttarakhand Tourism", "Goa Tourism",
                 "Rajasthan Tourism", "Uttar Pradesh Tourism"],
    "international": ["Australia", "Dubai", "Scotland", "Indonesia", "Spain", "Abu Dhabi", "Italy", "Singapore", "South Korea",
                      "USA", "Thailand", "Malaysia", "Vietnam", "Japan", "South Africa"],
}
BUSY = set()   # (bid, "x"|"competitors")


def env():
    out = {}
    try:
        for line in open(ENV_FILE):
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                out[k.strip()] = v.strip().strip('"').strip("'")
    except FileNotFoundError:
        pass
    return out


def token(group):
    e = env()
    own = {"meta": "APIFY_TOKEN_META", "x_linkedin": "APIFY_TOKEN_X_LINKEDIN"}[group]
    return (e.get(own) or e.get("APIFY_TOKEN") or os.environ.get(own) or os.environ.get("APIFY_TOKEN") or "").strip()


# ---------------- settings ----------------

def clean_handle(v, platform):
    """Accept @name, name or a profile URL; store the bare handle (YouTube keeps @handle or a channel id)."""
    v = str(v or "").strip()
    if not v:
        return ""
    v = re.sub(r"^https?://(www\.|m\.|mobile\.)?", "", v, flags=re.I)
    v = re.sub(r"^(facebook\.com|fb\.com|instagram\.com|x\.com|twitter\.com|linkedin\.com/company|linkedin\.com/in|youtube\.com)/", "", v, flags=re.I)
    v = v.split("?")[0].strip("/").lstrip("@")
    if platform == "facebook" and v.startswith("profile.php"):
        return ""
    if not re.fullmatch(r"[A-Za-z0-9_.\-@/]{1,100}", v):
        raise ValueError(f"The {platform} handle '{v[:40]}' has unexpected characters. Use the handle or the profile link.")
    return v


def config(b):
    r = dict((b or {}).get("report") or {})
    secs = r.get("sections") or {}
    r["sections"] = {k: bool(secs.get(k)) for k in SECTIONS}
    r["handles"] = {k: (r.get("handles") or {}).get(k, "") for k in HANDLE_KEYS}
    r["weekly"] = bool(r.get("weekly"))
    r["alert_id"] = r.get("alert_id") or ""
    comp = r.get("competitors") or {}
    r["competitors"] = {g: list(comp.get(g) or []) for g in ("national", "international")}
    return r


def update(bid, body):
    rep = body.get("report")
    if rep is None:
        return
    if not isinstance(rep, dict):
        raise ValueError("Report settings are not valid.")
    cur = config(sma.get_brand(bid))
    if "weekly" in rep:
        cur["weekly"] = bool(rep["weekly"])
    if isinstance(rep.get("sections"), dict):
        cur["sections"] = {k: bool(rep["sections"].get(k, cur["sections"][k])) for k in SECTIONS}
    if isinstance(rep.get("handles"), dict):
        cur["handles"] = {k: clean_handle(rep["handles"].get(k, cur["handles"][k]), k) for k in HANDLE_KEYS}
    if "alert_id" in rep:
        v = str(rep["alert_id"] or "")
        if v and not re.fullmatch(r"[A-Za-z0-9_\-]{1,40}", v):
            raise ValueError("Unknown listening alert.")
        cur["alert_id"] = v
    if isinstance(rep.get("competitors"), dict):
        comp = {}
        for g in ("national", "international"):
            rows = rep["competitors"].get(g) or []
            if not isinstance(rows, list) or len(rows) > 40:
                raise ValueError("Up to 40 competitors per group.")
            out = []
            for row in rows:
                name = " ".join(str((row or {}).get("name") or "").split())[:80]
                if not name:
                    continue
                out.append({"name": name, "facebook": clean_handle(row.get("facebook"), "facebook"), "instagram": clean_handle(row.get("instagram"), "instagram")})
            comp[g] = out
        cur["competitors"] = comp
    sma.update_brand_record(bid, lambda r: r.update({"report": cur}))


# ---------------- data files ----------------

def _path(bid, name):
    return sma._p(bid, name)


def load(bid, name):
    try:
        return json.load(open(_path(bid, name)))
    except Exception:
        return {}


def save(bid, name, d):
    p = _path(bid, name)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    tmp = p + ".tmp"
    json.dump(d, open(tmp, "w"))
    os.replace(tmp, p)


def _log(d, ok, msg, extra=None):
    d.setdefault("sync_log", []).append({"at": sma.iso(), "ok": ok, "message": msg[:400], **(extra or {})})
    d["sync_log"] = d["sync_log"][-20:]
    d["last_error"] = "" if ok else msg[:400]


def public(b):
    bid = b["id"]
    x, c = load(bid, "x.json"), load(bid, "competitors.json")
    months = sorted((c.get("months") or {}).keys())
    return {"config": config(b),
            "x": {"last_sync": x.get("last_sync"), "syncing": (bid, "x") in BUSY, "last_error": x.get("last_error", ""),
                  "posts": len(x.get("posts") or []), "followers": (x.get("profile") or {}).get("followers")},
            "competitors": {"last_sync": c.get("last_sync"), "syncing": (bid, "competitors") in BUSY, "last_error": c.get("last_error", ""),
                            "months": months},
            "has_token": {"meta": bool(token("meta")), "x": bool(token("x_linkedin"))}}


def data(bid):
    x, c = load(bid, "x.json"), load(bid, "competitors.json")
    x.pop("sync_log", None)
    return {"x": x, "competitors": c}


# ---------------- X via Apify ----------------

def _x_date(v):
    for fmt in ("%a %b %d %H:%M:%S %z %Y", "%Y-%m-%dT%H:%M:%S.%fZ", "%Y-%m-%dT%H:%M:%SZ"):
        try:
            d = datetime.strptime(str(v), fmt)
            return (d if d.tzinfo else d.replace(tzinfo=timezone.utc)).astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        except Exception:
            continue
    return ""


def _n(v):
    try:
        return int(float(v))
    except Exception:
        return None


def sync_x(bid, full=False):
    b = sma.get_brand(bid)
    handle = config(b)["handles"]["x"]
    d = load(bid, "x.json")
    try:
        if not handle:
            raise ValueError("Add the brand's X handle in Settings > Report first.")
        tok = token("x_linkedin")
        if not tok:
            raise ValueError("No Apify token for X. Add APIFY_TOKEN_X_LINKEDIN (or APIFY_TOKEN) in Settings > API keys.")
        if d.get("profile", {}).get("handle", "").lower() != handle.lower():
            d = {"followers_hist": {}, "posts": []}
        last = max([p.get("published", "") for p in d.get("posts") or []] or [""])
        since = sma.iso(time.time() - 35 * 86400) if full or not last else sma.iso(min(time.time() - 7 * 86400, datetime.strptime(last, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc).timestamp() - 2 * 86400))
        cap = 100 if full or not last else 40
        items, billed = fetch.apify_run_capped(X_ACTOR, {"twitterHandles": [handle], "maxItems": cap, "sort": "Latest", "start": since[:10], "includeSearchTerms": False}, tok, cap)
        posts, prof = [], None
        for i in items:
            if not isinstance(i, dict) or i.get("noResults"):
                continue
            au = i.get("author") or {}
            if str(au.get("userName") or "").lower() != handle.lower() or i.get("isRetweet") or i.get("retweet"):
                if prof is None and str(au.get("userName") or "").lower() == handle.lower():
                    prof = au
                continue
            prof = prof or au
            media = fetch.g(i, "extendedEntities.media", "entities.media", "media", default=[]) or []
            pic = ""
            if isinstance(media, list) and media:
                m0 = media[0] if isinstance(media[0], dict) else {}
                pic = m0.get("media_url_https") or m0.get("url") or m0.get("thumbnail") or ""
            pid = str(i.get("id") or "")
            if not pid:
                continue
            posts.append({"id": pid, "text": str(i.get("fullText") or i.get("text") or "")[:1200], "published": _x_date(i.get("createdAt")),
                          "url": i.get("url") or i.get("twitterUrl") or f"https://x.com/{handle}/status/{pid}", "picture": pic if str(pic).startswith("http") else "",
                          "likes": _n(i.get("likeCount")), "reposts": _n(i.get("retweetCount")), "replies": _n(i.get("replyCount")),
                          "quotes": _n(i.get("quoteCount")), "bookmarks": _n(i.get("bookmarkCount")), "views": _n(i.get("viewCount"))})
        for p in posts:
            p["thumb"] = sma.cache_thumb(bid, "x", p["id"], p.get("picture")) or None
        d["posts"] = sma.merge_posts(d.get("posts"), [p for p in posts if p["published"]])
        if prof:
            d["profile"] = {"handle": handle, "name": prof.get("name") or handle, "followers": _n(prof.get("followers")),
                            "following": _n(prof.get("following")), "picture": prof.get("profilePicture") or ""}
            if d["profile"]["followers"] is not None:
                d.setdefault("followers_hist", {})[datetime.now(timezone.utc).strftime("%Y-%m-%d")] = d["profile"]["followers"]
        else:
            d.setdefault("profile", {"handle": handle})
        d["last_sync"] = sma.iso()
        d["last_sync_date"] = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        _log(d, True, f"{len(posts)} posts", {"billed": billed})
    except Exception as e:
        d["last_sync_date"] = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        _log(d, False, f"X: {e}")
        sma.log(f"x sync {bid}: {e}")
    save(bid, "x.json", d)


# ---------------- competitors via Apify ----------------

def _key(h):
    return str(h or "").strip().lstrip("@").lower()


def competitor_handles(b):
    cfg = config(b)
    rows = cfg["competitors"]["national"] + cfg["competitors"]["international"]
    fb = {_key(r["facebook"]) for r in rows if r.get("facebook")}
    ig = {_key(r["instagram"]) for r in rows if r.get("instagram")}
    if cfg["handles"]["facebook"]:
        fb.add(_key(cfg["handles"]["facebook"]))
    if cfg["handles"]["instagram"]:
        ig.add(_key(cfg["handles"]["instagram"]))
    return sorted(fb), sorted(ig)


def sync_competitors(bid):
    b = sma.get_brand(bid)
    d = load(bid, "competitors.json")
    month = datetime.now(timezone.utc).strftime("%Y-%m")
    try:
        fb, ig = competitor_handles(b)
        if not fb and not ig:
            raise ValueError("Add competitor Facebook or Instagram handles in Settings > Report first.")
        tok = token("meta")
        if not tok:
            raise ValueError("No Apify token for Facebook/Instagram. Add APIFY_TOKEN_META (or APIFY_TOKEN) in Settings > API keys.")
        snap = (d.get("months") or {}).get(month) or {"fb": {}, "ig": {}, "names": {}}
        snap.setdefault("names", {})
        errors = []
        if ig:
            try:
                items, _ = fetch.apify_run_capped(IG_PROFILE_ACTOR, {"usernames": ig}, tok, len(ig) + 2)
                for i in items:
                    k = _key(i.get("username"))
                    if k in ig and _n(i.get("followersCount")) is not None:
                        snap["ig"][k] = _n(i.get("followersCount"))
                        snap["names"]["ig:" + k] = str(i.get("fullName") or "")[:80]
            except Exception as e:
                errors.append(f"Instagram: {e}")
        if fb:
            try:
                items, _ = fetch.apify_run_capped(FB_PAGES_ACTOR, {"startUrls": [{"url": f"https://www.facebook.com/{h}"} for h in fb]}, tok, len(fb) + 2)
                for i in items:
                    urls = " ".join(str(i.get(f) or "") for f in ("facebookUrl", "pageUrl", "url", "inputUrl")).lower()
                    k = next((h for h in fb if re.search(r"facebook\.com/" + re.escape(h) + r"(/|\b|$)", urls)), None) or (_key(i.get("pageName")) if _key(i.get("pageName")) in fb else None)
                    n = _n(i.get("followers")) if i.get("followers") is not None else _n(i.get("likes"))
                    if k and n is not None:
                        snap["fb"][k] = n
                        snap["names"]["fb:" + k] = str(i.get("title") or i.get("pageName") or "")[:80]
            except Exception as e:
                errors.append(f"Facebook: {e}")
        snap["at"] = sma.iso()
        d.setdefault("months", {})[month] = snap
        missing = [f"Facebook {h}" for h in fb if h not in snap["fb"]] + [f"Instagram {h}" for h in ig if h not in snap["ig"]]
        d["last_sync"] = sma.iso()
        msg = "; ".join(errors) or (f"Not found: {', '.join(missing[:8])}{'…' if len(missing) > 8 else ''}" if missing else "OK")
        _log(d, not errors, msg, {"found": len(snap["fb"]) + len(snap["ig"]), "missing": len(missing)})
        if missing and not errors:
            d["last_error"] = msg
    except Exception as e:
        _log(d, False, str(e))
        sma.log(f"competitors sync {bid}: {e}")
    d["last_attempt_month"] = month
    save(bid, "competitors.json", d)


def set_manual(bid, month, platform, handle, value):
    if not re.fullmatch(r"20\d\d-\d\d", str(month)) or platform not in ("fb", "ig"):
        raise ValueError("Unknown month or platform.")
    d = load(bid, "competitors.json")
    snap = d.setdefault("months", {}).setdefault(month, {"fb": {}, "ig": {}, "names": {}})
    k = _key(handle)
    if value in (None, ""):
        snap.setdefault("manual", {}).pop(platform + ":" + k, None)
    else:
        try:
            v = int(str(value).replace(",", ""))
        except ValueError:
            raise ValueError("Type a whole number.")
        if v < 0 or v > 5_000_000_000:
            raise ValueError("That follower count is out of range.")
        snap.setdefault("manual", {})[platform + ":" + k] = v
    save(bid, "competitors.json", d)


# ---------------- background runs ----------------

def run_async(bid, what, **kw):
    if (bid, what) in BUSY:
        raise RuntimeError("Already running.")
    BUSY.add((bid, what))

    def go():
        try:
            (sync_x if what == "x" else sync_competitors)(bid, **kw)
        finally:
            BUSY.discard((bid, what))
    threading.Thread(target=go, daemon=True).start()


def daily_due(today):
    """Called by the scheduler after the daily run time: X once a day, competitors once a month."""
    month = today[:7]
    for b in sma.brands():
        cfg = config(b)
        bid = b["id"]
        try:
            if cfg["sections"]["x"] and cfg["handles"]["x"] and load(bid, "x.json").get("last_sync_date") != today and (bid, "x") not in BUSY:
                run_async(bid, "x")
            c = load(bid, "competitors.json")
            if cfg["sections"]["competitors"] and c.get("last_attempt_month") != month and (bid, "competitors") not in BUSY and any(competitor_handles(b)):
                run_async(bid, "competitors")
        except Exception as e:
            sma.log(f"extra daily {bid}: {e}")
