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
HANDLE_KEYS = ("facebook", "instagram", "x", "linkedin", "youtube", "tiktok")
APIFY_PLATFORMS = ("facebook", "instagram", "x", "linkedin", "youtube", "tiktok")
APIFY_ACTORS = {"facebook": "apify~facebook-posts-scraper", "instagram": "apify~instagram-post-scraper", "x": X_ACTOR,
                "linkedin": "harvestapi~linkedin-profile-posts", "youtube": "streamers~youtube-scraper", "tiktok": "clockworks~tiktok-scraper"}
TOKEN_GROUP = {"facebook": "meta", "instagram": "meta", "x": "x_linkedin", "linkedin": "x_linkedin", "youtube": "other", "tiktok": "other"}
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
    own = {"meta": "APIFY_TOKEN_META", "x_linkedin": "APIFY_TOKEN_X_LINKEDIN", "other": "APIFY_TOKEN_OTHER"}[group]
    return (e.get(own) or e.get("APIFY_TOKEN") or os.environ.get(own) or os.environ.get("APIFY_TOKEN") or "").strip()


# ---------------- settings ----------------

def clean_handle(v, platform):
    """Accept @name, name or a profile URL; store the bare handle (YouTube keeps @handle or a channel id)."""
    v = str(v or "").strip()
    if not v:
        return ""
    v = re.sub(r"^https?://(www\.|m\.|mobile\.)?", "", v, flags=re.I)
    v = re.sub(r"^(facebook\.com|fb\.com|instagram\.com|x\.com|twitter\.com|linkedin\.com/company|linkedin\.com/in|youtube\.com/channel|youtube\.com/c|youtube\.com|tiktok\.com)/", "", v, flags=re.I)
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
    ap = r.get("apify") or {}
    r["apify"] = {k: bool(ap.get(k, k == "x" and r["sections"]["x"])) for k in APIFY_PLATFORMS}
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
    if isinstance(rep.get("apify"), dict):
        cur["apify"] = {k: bool(rep["apify"].get(k, cur["apify"][k])) for k in APIFY_PLATFORMS}
        cur["sections"]["x"] = cur["apify"]["x"]
    if isinstance(rep.get("handles"), dict):
        cur["handles"] = {k: clean_handle(rep["handles"].get(k, cur["handles"][k]), k) for k in HANDLE_KEYS}
    if "alert_id" in rep:
        v = str(rep["alert_id"] or "")
        if v and not re.fullmatch(r"[A-Za-z0-9_\-]{1,40}", v):  # "__brand__" = every alert linked to this brand
            raise ValueError("Unknown listening alert.")
        cur["alert_id"] = v
    if isinstance(rep.get("competitors"), dict):
        comp = {}
        for g in ("national", "international"):
            rows = rep["competitors"].get(g) or []
            if not isinstance(rows, list) or len(rows) > 40:
                raise ValueError("Up to 40 competitors per group.")  # one lookup per handle per month
            out = []
            for row in rows:
                name = " ".join(str((row or {}).get("name") or "").split())[:80]
                if not name:
                    continue
                out.append({"name": name, **{f: clean_handle(row.get(f), f) for f in ("facebook", "instagram", "x", "linkedin", "youtube")}})
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


def fname(plat):
    return "x.json" if plat == "x" else f"apify_{plat}.json"


def public(b):
    bid = b["id"]
    c = load(bid, "competitors.json")
    months = sorted((c.get("months") or {}).keys())
    month = datetime.now(timezone.utc).strftime("%Y-%m")
    st = {}
    for k in APIFY_PLATFORMS:
        d = load(bid, fname(k))
        st[k] = {"last_sync": d.get("last_sync"), "syncing": (bid, k) in BUSY, "last_error": d.get("last_error", ""),
                 "posts": len(d.get("posts") or []), "followers": (d.get("profile") or {}).get("followers"), "items_month": (d.get("billed") or {}).get(month, 0)}
    return {"config": config(b), "apify": st, "x": st["x"],
            "competitors": {"last_sync": c.get("last_sync"), "syncing": (bid, "competitors") in BUSY, "last_error": c.get("last_error", ""),
                            "months": months},
            "has_token": {"meta": bool(token("meta")), "x": bool(token("x_linkedin")), "other": bool(token("other"))}}


def data(bid):
    ap = {}
    for k in APIFY_PLATFORMS:
        d = load(bid, fname(k))
        d.pop("sync_log", None)
        ap[k] = d
    return {"x": ap["x"], "apify": ap, "competitors": load(bid, "competitors.json")}


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
    return sync_scrape(bid, "x", full)


# ---------------- brand's own public posts via Apify (all platforms) ----------------

def _first(i, *paths):
    """Like fetch.g, but also understands list indexes such as media.0.thumbnail."""
    for p in paths:
        v = i
        for part in p.split("."):
            if isinstance(v, list):
                v = v[int(part)] if part.isdigit() and int(part) < len(v) else None
            elif isinstance(v, dict):
                v = v.get(part)
            else:
                v = None
            if v is None:
                break
        if v not in (None, "", []):
            return v
    return None


def _date(v):
    if isinstance(v, (int, float)):
        v = v / 1000 if v > 1e11 else v
        return sma.iso(v)
    if isinstance(v, dict):
        v = v.get("date") or v.get("timestamp")
        return _date(v) if v else ""
    s = str(v or "")
    if re.fullmatch(r"\d{9,13}", s):
        return _date(int(s))
    d = _x_date(s)
    if d:
        return d
    try:
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
        return (dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)).astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    except Exception:
        return ""


def scrape_input(plat, h, cap, since, full):
    if plat == "facebook":
        return {"startUrls": [{"url": f"https://www.facebook.com/{h}"}], "resultsLimit": cap, "onlyPostsNewerThan": since}
    if plat == "instagram":
        return {"username": [h], "resultsLimit": cap, "onlyPostsNewerThan": since, "skipPinnedPosts": True}
    if plat == "x":
        return {"twitterHandles": [h], "maxItems": cap, "sort": "Latest", "start": since, "includeSearchTerms": False}
    if plat == "linkedin":
        return {"targetUrls": [f"https://www.linkedin.com/company/{h}/"], "maxPosts": cap, "postedLimit": "month" if full else "week", "includeReposts": False}
    if plat == "youtube":
        url = h if h.startswith("UC") and len(h) == 24 and not h.startswith("@") else ("@" + h.lstrip("@"))
        url = f"https://www.youtube.com/channel/{h}" if url == h else f"https://www.youtube.com/{url}"
        half = max(1, cap // 2)
        return {"startUrls": [{"url": url}], "maxResults": half, "maxResultsShorts": half, "maxResultStreams": 0, "sortVideosBy": "NEWEST",
                "oldestPostDate": since}
    if plat == "tiktok":
        return {"profiles": [h], "resultsPerPage": cap, "profileSorting": "latest", "excludePinnedPosts": True, "oldestPostDateUnified": since}


def scrape_map(plat, i, h):
    """One actor item -> (post or None, profile dict or None)."""
    if plat == "x":
        au = i.get("author") or {}
        mine = str(au.get("userName") or "").lower() == h.lower()
        prof = {"name": au.get("name"), "followers": _n(au.get("followers"))} if mine else None
        if not mine or i.get("isRetweet") or i.get("retweet"):
            return None, prof
        pid = str(i.get("id") or "")
        return ({"id": pid, "text": str(i.get("fullText") or i.get("text") or "")[:1200], "published": _x_date(i.get("createdAt")),
                 "url": i.get("url") or i.get("twitterUrl") or f"https://x.com/{h}/status/{pid}",
                 "picture": _first(i, "extendedEntities.media.0.media_url_https", "entities.media.0.media_url_https", "media.0.media_url_https", "media.0.url") or "",
                 "likes": _n(i.get("likeCount")), "reposts": _n(i.get("retweetCount")), "replies": _n(i.get("replyCount")),
                 "quotes": _n(i.get("quoteCount")), "bookmarks": _n(i.get("bookmarkCount")), "views": _n(i.get("viewCount"))} if pid else None), prof
    if plat == "facebook":
        pid = str(_first(i, "postId", "id") or "")
        return ({"id": pid, "text": str(_first(i, "text", "message", "postText") or "")[:1200], "published": _date(_first(i, "time", "timestamp", "date")),
                 "url": _first(i, "url", "topLevelUrl") or "", "picture": _first(i, "media.0.thumbnail", "media.0.photo_image.uri", "media.0.image.uri", "thumbnail", "fullPicture") or "",
                 "likes": _n(_first(i, "likes", "reactionsCount")), "comments": _n(_first(i, "comments", "commentsCount")), "shares": _n(_first(i, "shares", "sharesCount")),
                 "views": _n(_first(i, "viewsCount", "videoViewCount"))} if pid else None), None
    if plat == "instagram":
        pid = str(_first(i, "id", "shortCode") or "")
        prof = {"name": i.get("ownerFullName"), "followers": None} if i.get("ownerUsername") else None
        return ({"id": pid, "text": str(i.get("caption") or "")[:1200], "published": _date(i.get("timestamp")), "url": i.get("url") or "",
                 "picture": _first(i, "displayUrl", "images.0", "thumbnailUrl") or "", "type": i.get("type") or "",
                 "likes": _n(i.get("likesCount")), "comments": _n(i.get("commentsCount")), "views": _n(_first(i, "videoPlayCount", "videoViewCount"))} if pid else None), prof
    if plat == "linkedin":
        pid = str(_first(i, "id", "entityId", "linkedinUrl", "url") or "")
        foll = _n(_first(i, "author.info.followers", "author.followers", "author.followerCount"))
        return ({"id": pid, "text": str(_first(i, "content", "text", "commentary") or "")[:1200], "published": _date(_first(i, "postedAt.timestamp", "postedAt.date", "postedAt", "date")),
                 "url": _first(i, "linkedinUrl", "url", "postUrl") or "", "picture": _first(i, "postImages.0.url", "images.0.url", "image.url", "article.image.url") or "",
                 "likes": _n(_first(i, "engagement.likes", "numLikes")), "comments": _n(_first(i, "engagement.comments", "numComments")),
                 "shares": _n(_first(i, "engagement.shares", "numShares"))} if pid else None), ({"name": _first(i, "author.name"), "followers": foll} if foll is not None else None)
    if plat == "youtube":
        pid = str(_first(i, "id") or "")
        prof = {"name": i.get("channelName"), "followers": _n(_first(i, "numberOfSubscribers", "channelSubscribers"))}
        return ({"id": pid, "title": str(i.get("title") or "")[:300], "text": str(_first(i, "text", "description") or "")[:1200], "published": _date(_first(i, "date", "uploadDate", "publishedAt")),
                 "url": i.get("url") or f"https://www.youtube.com/watch?v={pid}", "picture": _first(i, "thumbnailUrl", "thumbnail") or (f"https://i.ytimg.com/vi/{pid}/mqdefault.jpg" if pid else ""),
                 "likes": _n(i.get("likes")), "comments": _n(_first(i, "commentsCount", "comments")), "views": _n(i.get("viewCount"))} if pid else None), prof
    if plat == "tiktok":
        pid = str(_first(i, "id") or "")
        prof = {"name": _first(i, "authorMeta.nickName", "authorMeta.name"), "followers": _n(_first(i, "authorMeta.fans"))}
        return ({"id": pid, "text": str(i.get("text") or "")[:1200], "published": _date(_first(i, "createTimeISO", "createTime")), "url": i.get("webVideoUrl") or "",
                 "picture": _first(i, "videoMeta.coverUrl", "covers.0") or "", "likes": _n(i.get("diggCount")), "comments": _n(i.get("commentCount")),
                 "shares": _n(i.get("shareCount")), "saves": _n(i.get("collectCount")), "views": _n(i.get("playCount"))} if pid else None), prof
    return None, None


def sync_scrape(bid, plat, full=False):
    b = sma.get_brand(bid)
    handle = config(b)["handles"].get(plat, "")
    name = fname(plat)
    d = load(bid, name)
    month = datetime.now(timezone.utc).strftime("%Y-%m")
    try:
        if not handle:
            raise ValueError(f"Add the brand's {plat} handle in Settings first.")
        tok = token(TOKEN_GROUP[plat])
        if not tok:
            raise ValueError("No Apify token for this platform. Add it in Sources > API keys (shared by all brands).")
        if (d.get("profile") or {}).get("handle", "").lower() != handle.lower():
            d = {"followers_hist": {}, "posts": [], "billed": d.get("billed") or {}}
        last = max([p.get("published", "") for p in d.get("posts") or []] or [""])
        first = full or not last
        since = sma.iso(time.time() - 35 * 86400) if first else sma.iso(min(time.time() - 7 * 86400, datetime.strptime(last, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc).timestamp() - 2 * 86400))
        cap = 60 if first else 30
        items, billed = fetch.apify_run_capped(APIFY_ACTORS[plat], scrape_input(plat, handle, cap, since[:10], first), tok, cap)
        posts, prof = [], {}
        for i in items:
            if not isinstance(i, dict) or i.get("noResults") or i.get("error"):
                continue
            post, pr = scrape_map(plat, i, handle)
            if pr:
                prof.update({k: v for k, v in pr.items() if v is not None})
            if post and post.get("published"):
                posts.append(post)
        if plat in ("facebook", "instagram") and tok:
            try:  # follower count: one profile lookup
                if plat == "instagram":
                    its, b2 = fetch.apify_run_capped(IG_PROFILE_ACTOR, {"usernames": [handle]}, tok, 2)
                    f = next((x for x in its if _key(x.get("username")) == _key(handle)), None)
                    if f:
                        prof.update({"name": f.get("fullName") or prof.get("name"), "followers": _n(f.get("followersCount"))})
                else:
                    its, b2 = fetch.apify_run_capped(FB_PAGES_ACTOR, {"startUrls": [{"url": f"https://www.facebook.com/{handle}"}]}, tok, 2)
                    f = its[0] if its else None
                    if f:
                        prof.update({"name": f.get("title") or f.get("pageName"), "followers": _n(f.get("followers") if f.get("followers") is not None else f.get("likes"))})
                billed += b2
            except Exception as e:
                sma.log(f"{plat} followers {bid}: {e}")
        for p in posts:
            p["thumb"] = sma.cache_thumb(bid, plat[:2] if plat != "x" else "x", p["id"], p.get("picture")) or None
        d["posts"] = sma.merge_posts(d.get("posts"), posts)
        d["profile"] = {**(d.get("profile") or {}), "handle": handle, **{k: v for k, v in prof.items() if v is not None}}
        if prof.get("followers") is not None:
            d.setdefault("followers_hist", {})[datetime.now(timezone.utc).strftime("%Y-%m-%d")] = prof["followers"]
        d.setdefault("billed", {})[month] = (d.get("billed") or {}).get(month, 0) + billed
        d["last_sync"] = sma.iso()
        _log(d, True, f"{len(posts)} posts", {"billed": billed})
    except Exception as e:
        _log(d, False, f"{plat}: {e}")
        sma.log(f"apify {plat} sync {bid}: {e}")
    d["last_sync_date"] = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    save(bid, name, d)


# ---------------- competitors via Apify ----------------

def _key(h):
    return str(h or "").strip().lstrip("@").lower()


COMP_PLATS = {"fb": "facebook", "ig": "instagram", "x": "x", "li": "linkedin", "yt": "youtube"}
X_USER_ACTOR = "apidojo~twitter-user-scraper"
LI_COMPANY_ACTOR = "harvestapi~linkedin-company"
YT_CHANNEL_ACTOR = "streamers~youtube-scraper"


def competitor_handles(b):
    """{"fb": [...], "ig": [...], ...}: every competitor handle per platform, plus the brand's own handles."""
    cfg = config(b)
    rows = cfg["competitors"]["national"] + cfg["competitors"]["international"]
    out = {}
    for pk, field in COMP_PLATS.items():
        k = (lambda h: str(h or "").strip().lstrip("@")) if pk == "yt" else _key  # YouTube channel IDs are case-sensitive
        hs = {k(r.get(field)) for r in rows if r.get(field)}
        if cfg["handles"].get(field):
            hs.add(k(cfg["handles"][field]))
        out[pk] = sorted({h for h in hs if h}, key=str.lower)
        if pk == "yt":
            seen, uniq = set(), []
            for h in out[pk]:
                if h.lower() not in seen:
                    seen.add(h.lower())
                    uniq.append(h)
            out[pk] = uniq
    return out


def _norm(s):
    return re.sub(r"[^a-z0-9]", "", str(s or "").lower())


def _yt_api(handles):
    key = env().get("YOUTUBE_API_KEY") or os.environ.get("YOUTUBE_API_KEY")
    if not key:
        return None
    import urllib.parse, urllib.request
    base = os.environ.get("SENTIMETER_YT_KEY_BASE", "https://www.googleapis.com/youtube/v3")
    got = {}
    for h in handles:
        q = {"part": "statistics,snippet", "key": key}
        q.update({"id": h} if re.fullmatch(r"UC[A-Za-z0-9_\-]{22}", h) else {"forHandle": "@" + h})
        try:
            with urllib.request.urlopen(f"{base}/channels?" + urllib.parse.urlencode(q), timeout=20) as r:
                it = (json.loads(r.read()).get("items") or [None])[0]
            if it and not (it.get("statistics") or {}).get("hiddenSubscriberCount"):
                got[h.lower()] = (_n((it.get("statistics") or {}).get("subscriberCount")), ((it.get("snippet") or {}).get("title") or "")[:80])
        except Exception as e:
            sma.log(f"youtube competitor {h}: {e}")
    return got


def _collect(pk, hs, tok):
    """Follower counts for one platform: {handle: (count, account name)}."""
    got = {}
    if pk == "ig":
        items, _ = fetch.apify_run_capped(IG_PROFILE_ACTOR, {"usernames": hs}, tok, len(hs) + 2)
        for i in items:
            k = _key(i.get("username"))
            if k in hs and _n(i.get("followersCount")) is not None:
                got[k] = (_n(i.get("followersCount")), str(i.get("fullName") or "")[:80])
    elif pk == "fb":
        items, _ = fetch.apify_run_capped(FB_PAGES_ACTOR, {"startUrls": [{"url": f"https://www.facebook.com/{h}"} for h in hs]}, tok, len(hs) + 2)
        for i in items:
            urls = " ".join(str(i.get(f) or "") for f in ("facebookUrl", "pageUrl", "url", "inputUrl")).lower()
            k = next((h for h in hs if re.search(r"facebook\.com/" + re.escape(h) + r"(/|\b|$)", urls)), None) or (_key(i.get("pageName")) if _key(i.get("pageName")) in hs else None)
            n = _n(i.get("followers")) if i.get("followers") is not None else _n(i.get("likes"))
            if k and n is not None:
                got[k] = (n, str(i.get("title") or i.get("pageName") or "")[:80])
    elif pk == "x":
        items, _ = fetch.apify_run_capped(X_USER_ACTOR, {"twitterHandles": hs, "maxItems": len(hs), "getFollowers": False, "getFollowing": False}, tok, len(hs) + 2)
        by = {_norm(h): h for h in hs}
        for i in items:
            k = by.get(_norm(_first(i, "userName", "username", "screen_name", "author.userName")))
            n = _n(_first(i, "followers", "followersCount", "followers_count", "author.followers"))
            if k and n is not None:
                got[k] = (n, str(_first(i, "name", "author.name") or "")[:80])
    elif pk == "li":
        items, _ = fetch.apify_run_capped(LI_COMPANY_ACTOR, {"companies": [f"https://www.linkedin.com/company/{h}/" for h in hs]}, tok, len(hs) + 2)
        by = {_norm(h): h for h in hs}
        for i in items:
            ident = _first(i, "universalName", "publicIdentifier", "linkedinUrl", "url", "companyUrl") or ""
            k = by.get(_norm(str(ident).rstrip("/").split("/")[-1])) or by.get(_norm(i.get("name")))
            n = _n(_first(i, "followerCount", "followersCount", "followers", "follower_count"))
            if k and n is not None:
                got[k] = (n, str(i.get("name") or "")[:80])
    elif pk == "yt":
        api = _yt_api(hs)
        if api is not None:
            got.update({h: v for h, v in api.items() if v[0] is not None})
            hs = [h for h in hs if h.lower() not in got]
        for h in hs:  # no API key, or not found through the API: one Apify lookup per channel
            url = f"https://www.youtube.com/channel/{h}" if re.fullmatch(r"UC[A-Za-z0-9_\-]{22}", h) else f"https://www.youtube.com/@{h}"
            items, _ = fetch.apify_run_capped(YT_CHANNEL_ACTOR, {"startUrls": [{"url": url}], "maxResults": 1, "maxResultsShorts": 0, "maxResultStreams": 0}, tok, 2)
            i = next((x for x in items if _n(x.get("numberOfSubscribers")) is not None), None)
            if i:
                got[h.lower()] = (_n(i.get("numberOfSubscribers")), str(i.get("channelName") or "")[:80])
    return got


def sync_competitors(bid):
    b = sma.get_brand(bid)
    d = load(bid, "competitors.json")
    month = datetime.now(timezone.utc).strftime("%Y-%m")
    try:
        hs = competitor_handles(b)
        if not any(hs.values()):
            raise ValueError("Add competitor handles in the Competitors tab first.")
        snap = (d.get("months") or {}).get(month) or {}
        for pk in COMP_PLATS:
            snap.setdefault(pk, {})
        snap.setdefault("names", {})
        errors, missing, found = [], [], 0
        for pk, lst in hs.items():
            if not lst:
                continue
            group = {"fb": "meta", "ig": "meta", "x": "x_linkedin", "li": "x_linkedin", "yt": "other"}[pk]
            tok = token(group)
            if not tok and not (pk == "yt" and (env().get("YOUTUBE_API_KEY") or os.environ.get("YOUTUBE_API_KEY"))):
                errors.append(f"{COMP_PLATS[pk].title()}: no Apify token")
                continue
            try:
                got = _collect(pk, lst, tok)
            except Exception as e:
                errors.append(f"{COMP_PLATS[pk].title()}: {e}")
                continue
            for h, (n, name) in got.items():
                snap[pk][h] = n
                if name:
                    snap["names"][f"{pk}:{h}"] = name
            found += len(got)
            missing += [f"{COMP_PLATS[pk].title()} {h}" for h in lst if h.lower() not in snap[pk]]
        snap["at"] = sma.iso()
        d.setdefault("months", {})[month] = snap
        d["last_sync"] = sma.iso()
        msg = "; ".join(errors + ([f"Not found: {', '.join(missing[:8])}{'…' if len(missing) > 8 else ''}"] if missing else [])) or "OK"
        _log(d, not errors, msg, {"found": found, "missing": len(missing)})
        if missing and not errors:
            d["last_error"] = msg
    except Exception as e:
        _log(d, False, str(e))
        sma.log(f"competitors sync {bid}: {e}")
    d["last_attempt_month"] = month
    save(bid, "competitors.json", d)


def set_manual(bid, month, platform, handle, value):
    if not re.fullmatch(r"20\d\d-\d\d", str(month)) or platform not in COMP_PLATS:
        raise ValueError("Unknown month or platform.")
    d = load(bid, "competitors.json")
    snap = d.setdefault("months", {}).setdefault(month, {"names": {}})
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
            if what == "competitors":
                sync_competitors(bid)
            else:
                sync_scrape(bid, what, **kw)
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
            for k in APIFY_PLATFORMS:
                if cfg["apify"][k] and cfg["handles"].get(k) and load(bid, fname(k)).get("last_sync_date") != today and (bid, k) not in BUSY:
                    run_async(bid, k)
            c = load(bid, "competitors.json")
            if c.get("last_attempt_month") != month and (bid, "competitors") not in BUSY and any(competitor_handles(b).values()):
                run_async(bid, "competitors")
        except Exception as e:
            sma.log(f"extra daily {bid}: {e}")


# ---------------- one-time data updates shipped with the code ----------------

SEEDS = {
    # Karnataka Tourism: domestic competitors (Facebook + Instagram) and the brand's own handles
    "kt-domestic-2026-11": {
        "brand": "Karnataka Tourism",
        "handles": {"facebook": "KarnatakaWorld", "instagram": "karnatakaworld"},
        "national": [
            {"name": "Gujarat Tourism", "facebook": "gujtourism", "instagram": "gujarattourism"},
            {"name": "Madhya Pradesh Tourism", "facebook": "MPTourism", "instagram": "mptourism"},
            {"name": "Incredible India Tourism", "facebook": "incredibleindia", "instagram": "incredibleindia"},
            {"name": "Uttarakhand Tourism", "facebook": "UttarakhandTourismOfficialPage", "instagram": "uttarakhand_tourismofficial"},
            {"name": "Maharashtra Tourism", "facebook": "MaharashtraTourismOfficial", "instagram": "maharashtratourismofficial"},
            {"name": "Goa Tourism", "facebook": "officialgoatourism"},
            {"name": "Rajasthan Tourism", "facebook": "rajasthantourism", "instagram": "rajasthan_tourism"},
            {"name": "Uttar Pradesh Tourism", "instagram": "uttarpradeshtourism"},
        ],
    },
    # Karnataka Tourism: international competitors (Facebook + Instagram)
    "kt-international-2026-11": {
        "brand": "Karnataka Tourism",
        "handles": {"facebook": "KarnatakaWorld", "instagram": "karnatakaworld"},
        "international": [
            {"name": "Australia", "facebook": "SeeAustralia", "instagram": "australia"},
            {"name": "Dubai", "facebook": "visitdubai", "instagram": "visit.dubai"},
            {"name": "USA", "facebook": "VisitTheUSA", "instagram": "visittheusa"},
            {"name": "Singapore", "facebook": "VisitSingaporeOfficial", "instagram": "visit_singapore"},
            {"name": "Thailand", "facebook": "AmazingThailand", "instagram": "tourismthailand"},
            {"name": "Spain", "facebook": "spain.info", "instagram": "spain"},
            {"name": "Scotland", "facebook": "visitscotland", "instagram": "visitscotland"},
            {"name": "Malaysia", "facebook": "malaysia.travel.my", "instagram": "malaysia.truly.asia"},
            {"name": "Abu Dhabi", "facebook": "visitabudhabi", "instagram": "visitabudhabi"},
            {"name": "Vietnam", "facebook": "VietnamTourismBoard", "instagram": "vietnamtourismboard"},
            {"name": "South Korea", "facebook": "koreatourism", "instagram": "visitkorea_travel"},
            {"name": "Japan", "facebook": "visitjapan", "instagram": "visitjapan.us"},
            {"name": "Indonesia", "facebook": "WonderfulIndonesia", "instagram": "wonderfulindonesia"},
            {"name": "South Africa", "facebook": "SouthAfricanTourism", "instagram": "visitsouthafrica"},
            {"name": "Italy", "facebook": "italiait.EN", "instagram": "italiait"},
        ],
    },
}


def apply_seeds():
    """Apply each seed once (recorded in seeds.json); merges into existing settings, never removes anything."""
    path = sma._p("seeds.json")
    try:
        done = set(json.load(open(path)))
    except Exception:
        done = set()
    collect = set()
    for sid, s in SEEDS.items():
        if sid in done:
            continue
        try:
            b = next((x for x in sma.brands() if x["name"].strip().lower() == s["brand"].lower()), None) or sma.create_brand(s["brand"])
            cfg = config(b)
            for f, h in s.get("handles", {}).items():
                if not cfg["handles"].get(f):
                    cfg["handles"][f] = h
            for g in ("national", "international"):
                for row in s.get(g, []):
                    cur = next((r for r in cfg["competitors"][g] if r["name"].lower() == row["name"].lower()), None)
                    if cur is None:
                        cfg["competitors"][g].append({"name": row["name"], **{f: "" for f in ("facebook", "instagram", "x", "linkedin", "youtube")}, **row})
                    else:
                        for f, h in row.items():
                            if f != "name" and h:
                                cur[f] = h
            sma.update_brand_record(b["id"], lambda r: r.update({"report": cfg}))
            done.add(sid)
            os.makedirs(os.path.dirname(path), exist_ok=True)
            json.dump(sorted(done), open(path, "w"))
            sma.log(f"seed {sid}: applied to {b['name']} ({b['id']})")
            collect.add(b["id"])
        except Exception as e:
            sma.log(f"seed {sid} failed: {e}")
    for bid in collect:  # one collection per brand, after every seed is in place
        if token("meta") and (bid, "competitors") not in BUSY:
            run_async(bid, "competitors")

