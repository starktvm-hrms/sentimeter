#!/usr/bin/env python3
"""Sentimeter fetcher: collect real public mentions for the configured keywords.

Writes public/data/mentions.json, which the site loads on start. Runs from cron
on the server (see deploy/setup-fetcher.sh). Python standard library only.

Sources (each skipped cleanly when disabled or missing a key):
  google_news  Google News RSS search (no key)
  reddit       Reddit search JSON (no key)
  bluesky      Bluesky public post search (no key)
  youtube      YouTube Data API v3 (env YOUTUBE_API_KEY)
  apify        X and Instagram via Apify actors (env APIFY_TOKEN, paid per use)

Usage: fetch.py [--config fetcher/config.json] [--out public/data/mentions.json] [--only google_news,reddit] [--force]
"""
import argparse, calendar, email.utils, fcntl, hashlib, html, json, os, re, sys, time, urllib.parse, urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
UA = "Sentimeter/1.0 (social listening; +https://sentimeter.starkpeople.in)"
NOW = datetime.now(timezone.utc)
SETTINGS_PATH = os.environ.get("SENTIMETER_SETTINGS", "/etc/sentimeter/settings.json")
USAGE_PATH = os.environ.get("SENTIMETER_USAGE", "/var/lib/sentimeter/usage.json")
LOCK_PATH = os.environ.get("SENTIMETER_LOCK", "/tmp/sentimeter-fetch.lock")
DATA_DIR = os.environ.get("SENTIMETER_DATA_DIR", "/var/lib/sentimeter/data")


def log(*a):
    print(datetime.now().strftime("%H:%M:%S"), *a, file=sys.stderr)


def http(url, data=None, headers=None, timeout=40):
    h = {"User-Agent": UA, "Accept": "application/json, application/xml;q=0.9, */*;q=0.5"}
    h.update(headers or {})
    body = json.dumps(data).encode() if data is not None else None
    if body is not None:
        h["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=body, headers=h, method="POST" if body is not None else "GET")
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def iso(dt):
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def parse_date(s):
    if not s:
        return None
    if isinstance(s, (int, float)):
        return datetime.fromtimestamp(s, timezone.utc)
    try:
        return email.utils.parsedate_to_datetime(s).astimezone(timezone.utc)
    except Exception:
        pass
    for fmt in ("%Y-%m-%dT%H:%M:%S.%fZ", "%Y-%m-%dT%H:%M:%SZ", "%a %b %d %H:%M:%S %z %Y"):
        try:
            d = datetime.strptime(s, fmt)
            return d if d.tzinfo else d.replace(tzinfo=timezone.utc)
        except Exception:
            pass
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00")).astimezone(timezone.utc)
    except Exception:
        return None


def strip_html(s):
    s = re.sub(r"<[^>]+>", " ", s or "")
    return re.sub(r"\s+", " ", html.unescape(s)).strip()


def mid(source, key):
    return source[:2] + hashlib.sha1(f"{source}|{key}".encode()).hexdigest()[:14]


def norm_text(s):
    s = re.sub(r"https?://\S+", " ", (s or "").lower())
    s = re.sub(r"[#@]", "", s)
    return re.sub(r"[^\w]+", " ", s, flags=re.U).strip()


def canon_url(u):
    if not u:
        return ""
    try:
        p = urllib.parse.urlparse(u.strip())
    except Exception:
        return ""
    host = re.sub(r"^(www\.|m\.|mobile\.)", "", (p.netloc or "").lower())
    if not host or host in ("news.google.com", "bing.com"):
        return ""
    keep = {k: v for k, v in urllib.parse.parse_qs(p.query).items() if k in ("v", "story_fbid", "id", "fbid")}
    q = urllib.parse.urlencode(sorted((k, v[0]) for k, v in keep.items()))
    return f"{host}{p.path.rstrip('/')}" + (f"?{q}" if q else "")


def dedupe_key(m):
    """One identity per post: news by headline, social by canonical URL, else author + text."""
    if m.get("platform") == "News/Blogs":
        t = norm_text(m.get("title") or m.get("text", ""))
        return "news:" + t[:140] if t else "id:" + m["id"]
    u = canon_url(m.get("url", ""))
    if u:
        return f"{m.get('platform')}:{u}"
    t = norm_text(m.get("text", ""))
    return f"{m.get('platform')}:{(m.get('handle') or m.get('author') or '').lower()}:{t[:180]}" if t else "id:" + m["id"]


def chunks(terms, size):
    for i in range(0, len(terms), size):
        yield terms[i:i + size]


def q_term(k):
    k = k.lstrip("#").strip()
    return f'"{k}"' if " " in k else k


def kw_regex(k):
    e = re.escape(k.strip()).replace(r"\ ", r"\s+")
    return re.compile(r"(?<![\w])" + e + r"(?![\w])", re.I)


# ---------------- sources ----------------

def src_google_news(cfg, kws):
    out = []
    terms = sorted({q_term(k) for k in kws}, key=str.lower)
    for hl, gl, ceid in cfg.get("editions", [["en-IN", "IN", "IN:en"]]):
        for group in chunks(terms, 8):
            q = " OR ".join(group) + f" when:{cfg.get('window', '2d')}"
            url = "https://news.google.com/rss/search?" + urllib.parse.urlencode({"q": q, "hl": hl, "gl": gl, "ceid": ceid})
            try:
                root = ET.fromstring(http(url))
            except Exception as e:
                log("google_news", hl, "failed:", e)
                continue
            for it in root.iter("item"):
                title = (it.findtext("title") or "").strip()
                src = it.find("source")
                publisher = (src.text if src is not None else "") or ""
                site = src.get("url", "") if src is not None else ""
                if publisher and title.endswith(" - " + publisher):
                    title = title[: -len(publisher) - 3]
                desc = strip_html(it.findtext("description") or "")
                text = title if not desc or desc.startswith(title) else f"{title}. {desc}"
                d = parse_date(it.findtext("pubDate"))
                link = it.findtext("link") or ""
                out.append({"id": mid("gn", link or title), "date": iso(d or NOW), "platform": "News/Blogs",
                            "author": publisher or "Google News", "handle": urllib.parse.urlparse(site).netloc.replace("www.", ""),
                            "location": "India" if gl == "IN" else "", "title": title, "text": text, "url": link, "reach": 0})
            time.sleep(1)
    return out


def bing_target(link):
    try:
        q = urllib.parse.parse_qs(urllib.parse.urlparse(link).query)
        return q.get("url", [link])[0]
    except Exception:
        return link


def src_bing_news(cfg, kws):
    out = []
    terms = sorted({k.lstrip("#").strip() for k in kws if k.strip()}, key=str.lower)[: cfg.get("max_terms", 40)]
    for k in terms:
        url = "https://www.bing.com/news/search?" + urllib.parse.urlencode({"q": f'"{k}"' if " " in k else k, "format": "rss", "setmkt": cfg.get("market", "en-IN")})
        try:
            root = ET.fromstring(http(url, headers={"User-Agent": "Mozilla/5.0 (compatible; Sentimeter/1.0)"}))
        except Exception as e:
            log("bing_news failed:", k, e)
            continue
        for it in root.iter("item"):
            title = (it.findtext("title") or "").strip()
            publisher = next((c.text for c in it if c.tag.endswith("Source") and c.text), "") or ""
            publisher = re.sub(r"\s+on MSN$", "", publisher)
            link = bing_target(it.findtext("link") or "")
            desc = strip_html(it.findtext("description") or "")
            out.append({"id": mid("bn", link or title), "date": iso(parse_date(it.findtext("pubDate")) or NOW), "platform": "News/Blogs",
                        "author": publisher or "Bing News", "handle": urllib.parse.urlparse(link).netloc.replace("www.", ""),
                        "location": "India" if cfg.get("market", "en-IN").endswith("IN") else "", "title": title,
                        "text": title if not desc else f"{title}. {desc}", "url": link, "reach": 0})
        time.sleep(1)
    return out


def src_reddit(cfg, kws):
    out = []
    terms = sorted({q_term(k) for k in kws}, key=str.lower)
    for group in chunks(terms, 6):
        url = "https://www.reddit.com/search.json?" + urllib.parse.urlencode({"q": " OR ".join(group), "sort": "new", "t": "week", "limit": 100})
        try:
            data = json.loads(http(url))
        except Exception as e:
            log("reddit failed:", e)
            break
        for ch in data.get("data", {}).get("children", []):
            p = ch.get("data", {})
            text = (p.get("title", "") + ". " + (p.get("selftext") or "")[:1500]).strip(". ")
            out.append({"id": mid("rd", p.get("id", "")), "date": iso(parse_date(p.get("created_utc")) or NOW), "platform": "Reddit",
                        "author": "u/" + p.get("author", "unknown"), "handle": "r/" + p.get("subreddit", ""), "location": "",
                        "title": p.get("title", ""), "text": text, "url": "https://www.reddit.com" + p.get("permalink", ""),
                        "reach": int(p.get("subreddit_subscribers") or 0)})
        time.sleep(2)
    return out


def src_bluesky(cfg, kws):
    out = []
    for k in sorted(set(k.lstrip("#") for k in kws), key=str.lower):
        url = "https://public.api.bsky.app/xrpc/app.bsky.feed.searchPosts?" + urllib.parse.urlencode({"q": k, "limit": 50, "sort": "latest"})
        try:
            data = json.loads(http(url))
        except Exception as e:
            log("bluesky failed:", e)
            break
        for p in data.get("posts", []):
            a = p.get("author", {})
            rec = p.get("record", {})
            rkey = p.get("uri", "").rsplit("/", 1)[-1]
            out.append({"id": mid("bs", p.get("uri", "")), "date": iso(parse_date(rec.get("createdAt")) or NOW), "platform": "Web",
                        "author": a.get("displayName") or a.get("handle", ""), "handle": a.get("handle", ""), "location": "",
                        "text": rec.get("text", ""), "url": f"https://bsky.app/profile/{a.get('handle','')}/post/{rkey}",
                        "lang": (rec.get("langs") or [""])[0], "reach": int(p.get("likeCount", 0)) + int(p.get("repostCount", 0))})
        time.sleep(0.5)
    return out


def src_youtube(cfg, kws):
    key = os.environ.get("YOUTUBE_API_KEY")
    if not key:
        log("youtube skipped: set YOUTUBE_API_KEY in /etc/sentimeter.env")
        return None
    out, ids = [], []
    terms = sorted({q_term(k) for k in kws}, key=str.lower)
    after = iso(NOW - timedelta(days=3))
    for group in chunks(terms, 10):
        url = "https://www.googleapis.com/youtube/v3/search?" + urllib.parse.urlencode({
            "part": "snippet", "q": "|".join(group), "type": "video", "order": "date", "publishedAfter": after,
            "maxResults": cfg.get("max_results", 25), "regionCode": "IN", "key": key})
        try:
            data = json.loads(http(url))
        except Exception as e:
            log("youtube failed:", e)
            break
        for it in data.get("items", []):
            vid = it["id"].get("videoId")
            s = it["snippet"]
            ids.append(vid)
            out.append({"id": mid("yt", vid), "vid": vid, "date": iso(parse_date(s.get("publishedAt")) or NOW), "platform": "YouTube",
                        "author": s.get("channelTitle", ""), "handle": "", "location": "",
                        "title": html.unescape(s.get("title", "")),
                        "text": html.unescape(s.get("title", "")) + ". " + html.unescape(s.get("description", "")),
                        "url": f"https://www.youtube.com/watch?v={vid}", "reach": 0})
    for group in chunks(ids, 50):  # view counts as reach
        try:
            data = json.loads(http("https://www.googleapis.com/youtube/v3/videos?" + urllib.parse.urlencode({"part": "statistics", "id": ",".join(group), "key": key})))
            views = {v["id"]: int(v.get("statistics", {}).get("viewCount", 0)) for v in data.get("items", [])}
            for m in out:
                if m.get("vid") in views:
                    m["reach"] = views[m["vid"]]
        except Exception as e:
            log("youtube stats failed:", e)
    for m in out:
        m.pop("vid", None)
    return out


def apify_run(actor, payload, token):
    url = f"https://api.apify.com/v2/acts/{actor}/run-sync-get-dataset-items?" + urllib.parse.urlencode({"token": token, "timeout": 240})
    return json.loads(http(url, data=payload, timeout=300))


def src_apify(cfg, kws):
    token = os.environ.get("APIFY_TOKEN")
    if not token:
        log("apify skipped: set APIFY_TOKEN in /etc/sentimeter.env to collect X and Instagram")
        return None
    out = []
    x = cfg.get("x")
    if x:
        terms = sorted({k for k in kws}, key=str.lower)
        try:
            items = apify_run(x["actor"], {"searchTerms": terms, "maxItems": x.get("max_items", 200), "sort": "Latest"}, token)
            for t in items:
                a = t.get("author") or {}
                text = t.get("fullText") or t.get("text") or ""
                if not text:
                    continue
                out.append({"id": mid("x", str(t.get("id") or t.get("url") or text)), "date": iso(parse_date(t.get("createdAt")) or NOW),
                            "platform": "X", "author": a.get("name") or a.get("userName", ""), "handle": a.get("userName", ""),
                            "location": a.get("location", ""), "text": text, "url": t.get("url") or t.get("twitterUrl", ""),
                            "lang": t.get("lang", ""), "reach": int(t.get("viewCount") or 0), "reach_basis": "views"})
        except Exception as e:
            log("apify x failed:", e)
    ig = cfg.get("instagram")
    if ig:
        tags = sorted({k.lstrip("#").replace(" ", "").lower() for k in kws if k.startswith("#") or " " not in k})
        try:
            items = apify_run(ig["actor"], {"hashtags": tags, "resultsLimit": ig.get("results_limit", 100)}, token)
            for p in items:
                text = p.get("caption") or ""
                if not text:
                    continue
                out.append({"id": mid("ig", str(p.get("id") or p.get("url") or text)), "date": iso(parse_date(p.get("timestamp")) or NOW),
                            "platform": "Instagram", "author": p.get("ownerFullName") or p.get("ownerUsername", "Instagram user"),
                            "handle": p.get("ownerUsername", ""), "location": p.get("locationName") or "", "text": text,
                            "url": p.get("url", ""), "reach": int(p.get("likesCount") or 0) + int(p.get("commentsCount") or 0)})
        except Exception as e:
            log("apify instagram failed:", e)
    return out



# ---------------- tracked social accounts (Apify, daily, budgeted) ----------------

PLATFORMS = ["facebook", "instagram", "x", "linkedin", "youtube", "tiktok", "snapchat"]
DEFAULT_ACTORS = {
    "facebook": "apify~facebook-posts-scraper",
    "instagram": "apify~instagram-post-scraper",
    "x": "apidojo~tweet-scraper",
    "linkedin": "harvestapi~linkedin-profile-posts",
    "youtube": "youtube-data-api",
    "tiktok": "clockworks~tiktok-scraper",
    "snapchat": "parseforge~snapchat-scraper",
    "x_search": "apidojo~tweet-scraper",
    "instagram_hashtags": "apify~instagram-hashtag-scraper",
    "facebook_search": "apify~facebook-search-scraper",
    "linkedin_search": "harvestapi~linkedin-post-search",
    "tiktok_hashtags": "clockworks~tiktok-scraper",
    "snapchat_hashtags": "w3crawler~snapchat-hashtag-scraper",
}
TOKEN_GROUPS = {
    "meta": ["facebook", "instagram", "facebook_search", "instagram_hashtags"],
    "x_linkedin": ["x", "linkedin", "x_search", "linkedin_search"],
    "other": ["youtube", "tiktok", "snapchat", "tiktok_hashtags", "snapchat_hashtags"],
}
TOKEN_ENV = {"meta": "APIFY_TOKEN_META", "x_linkedin": "APIFY_TOKEN_X_LINKEDIN", "other": "APIFY_TOKEN_OTHER"}


def token_for(job):
    """The Apify token for a job: its group's own token, else the default APIFY_TOKEN."""
    grp = next((g for g, jobs in TOKEN_GROUPS.items() if job in jobs), "other")
    own = os.environ.get(TOKEN_ENV[grp], "").strip()
    return (own or os.environ.get("APIFY_TOKEN", "").strip()), (grp if own else "default")


KEYWORD_JOBS = ["x_search", "instagram_hashtags", "facebook_search", "linkedin_search", "tiktok_hashtags", "snapchat_hashtags"]
DEFAULT_SETTINGS = {
    "accounts": {p: [] for p in PLATFORMS},
    "actors": dict(DEFAULT_ACTORS),
    "keyword_search": {k: False for k in ["x_search", "instagram_hashtags", "facebook_search", "linkedin_search", "tiktok_hashtags", "snapchat_hashtags"]},
    "include_mentions": True,
    "search_terms": [],
    "monthly_limit": 5000,
    "news": {"google_news": True, "bing_news": True},
    "run_after": "09:00",
    "timezone": "Asia/Kolkata",
}


def load_settings():
    s = json.loads(json.dumps(DEFAULT_SETTINGS))
    try:
        user = json.load(open(SETTINGS_PATH))
    except FileNotFoundError:
        user = {}
    for k, v in user.items():
        if isinstance(v, dict) and isinstance(s.get(k), dict):
            s[k].update(v)
        else:
            s[k] = v
    return s


def local_now(tzname):
    try:
        from zoneinfo import ZoneInfo
        return NOW.astimezone(ZoneInfo(tzname))
    except Exception:
        return NOW.astimezone(timezone(timedelta(hours=5, minutes=30)))


def load_usage():
    try:
        return json.load(open(USAGE_PATH))
    except Exception:
        return {"months": {}, "last_daily_run": None}


def save_usage(u):
    os.makedirs(os.path.dirname(USAGE_PATH), exist_ok=True)
    tmp = USAGE_PATH + ".tmp"
    json.dump(u, open(tmp, "w"), indent=1)
    os.replace(tmp, USAGE_PATH)


def apify_call(path, token, data=None, timeout=60):
    url = os.environ.get("SENTIMETER_APIFY_BASE", "https://api.apify.com/v2") + path
    return json.loads(http(url, data=data, headers={"Authorization": "Bearer " + token}, timeout=timeout))


def apify_run_capped(actor, payload, token, max_items):
    """Start an actor run that Apify itself caps at max_items results, wait, return (items, billed_count)."""
    q = urllib.parse.urlencode({"maxItems": max_items, "maxTotalChargeUsd": os.environ.get("SENTIMETER_MAX_USD_PER_RUN", "1"), "waitForFinish": 60})
    run = apify_call(f"/acts/{urllib.parse.quote(actor, safe='~')}/runs?{q}", token, data=payload, timeout=90)["data"]
    t0 = time.time()
    while run["status"] in ("READY", "RUNNING") and time.time() - t0 < 900:
        run = apify_call(f"/actor-runs/{run['id']}?waitForFinish=60", token, timeout=90)["data"]
    ds = run.get("defaultDatasetId")
    items = apify_call(f"/datasets/{ds}/items?clean=true&format=json&limit={max_items * 3}", token, timeout=120) if ds else []
    items = items if isinstance(items, list) else []
    try:
        billed = max(int(apify_call(f"/datasets/{ds}", token)["data"].get("itemCount") or 0), len(items))
    except Exception:
        billed = len(items)
    if run["status"] not in ("SUCCEEDED", "TIMED-OUT"):
        log(f"apify {actor} run ended {run['status']}")
    return items if isinstance(items, list) else [], billed


def g(d, *paths, default=""):
    """First non-empty value among dotted paths."""
    for p in paths:
        v = d
        for part in p.split("."):
            v = v.get(part) if isinstance(v, dict) else None
            if v is None:
                break
        if v not in (None, "", []):
            return v
    return default


def num(*vals):
    tot = 0
    for v in vals:
        try:
            tot += int(v or 0)
        except Exception:
            pass
    return tot


def as_text(v):
    """Actors sometimes return an object where a name is expected (e.g. author: {id, name, ...})."""
    if isinstance(v, dict):
        return str(v.get("name") or v.get("username") or v.get("userName") or v.get("title") or v.get("id") or "")
    if isinstance(v, list):
        return " ".join(as_text(x) for x in v if x)
    return "" if v is None else str(v)


def mention(platform, key, date, author, handle, text, url, reach, location="", title=""):
    author, handle, text, url, location, title = map(as_text, (author, handle, text, url, location, title))
    if isinstance(date, (int, float)) and date > 1e11:
        date = date / 1000
    d = parse_date(date) if not isinstance(date, datetime) else date
    return {"id": mid(platform[:2], str(key or url or text)), "date": iso(d or NOW), "platform": platform, "author": author or handle or platform,
            "handle": handle or "", "location": location or "", "title": title or "", "text": text, "url": url or "", "reach": reach, "tracked": True}


MAPPERS = {
    "facebook": lambda i: mention("Facebook", g(i, "postId", "id", "url"), g(i, "time", "timestamp", "date"), g(i, "pageName", "user.name", "author.name", "authorName"),
                                  g(i, "pageName", "user.id", "author.id"), g(i, "text", "message", "postText"), g(i, "url", "topLevelUrl"),
                                  num(g(i, "likes", default=0), g(i, "comments", default=0), g(i, "shares", default=0))),
    "instagram": lambda i: mention("Instagram", g(i, "id", "shortCode", "url"), g(i, "timestamp"), g(i, "ownerFullName", "ownerUsername"), g(i, "ownerUsername"),
                                   g(i, "caption"), g(i, "url"), num(g(i, "likesCount", default=0), g(i, "commentsCount", default=0)), g(i, "locationName")),
    "instagram_hashtags": lambda i: MAPPERS["instagram"](i),
    "x": lambda i: mention("X", g(i, "id", "url"), g(i, "createdAt"), g(i, "author.name", "author.userName"), g(i, "author.userName"),
                           g(i, "fullText", "text"), g(i, "url", "twitterUrl"), num(g(i, "viewCount", "views", default=0)), g(i, "author.location")),
    "x_search": lambda i: MAPPERS["x"](i),
    "linkedin": lambda i: mention("LinkedIn", g(i, "id", "linkedinUrl", "url"), g(i, "postedAt.date", "postedAt.timestamp", "postedAt", "date"),
                                  g(i, "author.name", "authorName"), g(i, "author.publicIdentifier", "author.universalName", "author.linkedinUrl"),
                                  g(i, "content", "text", "commentary"), g(i, "linkedinUrl", "url", "postUrl"),
                                  num(g(i, "engagement.likes", "numLikes", default=0), g(i, "engagement.comments", "numComments", default=0), g(i, "engagement.shares", "numShares", default=0))),
    "youtube": lambda i: mention("YouTube", g(i, "id", "url"), g(i, "date", "uploadDate", "publishedAt"), g(i, "channelName"), g(i, "channelUsername", "channelUrl"),
                                 (g(i, "title") + ". " + g(i, "text", "description")).strip(". "), g(i, "url"), num(g(i, "viewCount", default=0)), title=g(i, "title")),
    "tiktok": lambda i: mention("TikTok", g(i, "id", "webVideoUrl"), g(i, "createTimeISO", "createTime"), g(i, "authorMeta.nickName", "authorMeta.name"), g(i, "authorMeta.name"),
                                g(i, "text"), g(i, "webVideoUrl"), num(g(i, "playCount", default=0)), g(i, "locationCreated")),
    "snapchat": lambda i: mention("Snapchat", g(i, "id", "snapId", "url"), g(i, "postedAt", "uploadedAt", "createdAt", "uploadDate", "timestamp"),
                                  g(i, "creatorUsername", "username", "creator.username", "creatorName"), g(i, "creatorUsername", "username", "creator.username"),
                                  g(i, "title", "caption", "description", "text", "name"), g(i, "url", "spotlightUrl", "shareUrl"), num(g(i, "viewCount", "views", default=0))),
    "facebook_search": lambda i: MAPPERS["facebook"](i),
    "linkedin_search": lambda i: MAPPERS["linkedin"](i),
    "tiktok_hashtags": lambda i: MAPPERS["tiktok"](i),
    "snapchat_hashtags": lambda i: MAPPERS["snapchat"](i),
}


def platform_input(platform, accounts, keywords, per, total, today):
    if platform == "facebook":
        urls = [a if a.startswith("http") else f"https://www.facebook.com/{a.lstrip('@')}" for a in accounts]
        return {"startUrls": [{"url": u} for u in urls], "resultsLimit": per, "onlyPostsNewerThan": today}
    if platform == "instagram":
        return {"username": [a.lstrip("@") for a in accounts], "resultsLimit": per, "onlyPostsNewerThan": today, "skipPinnedPosts": True}
    if platform == "x":
        return {"twitterHandles": [a.lstrip("@").split("/")[-1] for a in accounts], "maxItems": total, "sort": "Latest", "start": today}
    if platform == "linkedin":
        urls = [a if a.startswith("http") else f"https://www.linkedin.com/company/{a}/" for a in accounts]
        return {"targetUrls": urls, "maxPosts": per, "postedLimit": "24h", "includeReposts": False}
    if platform == "youtube":
        urls = [a if a.startswith("http") else f"https://www.youtube.com/{a if a.startswith('@') else '@' + a}" for a in accounts]
        half = max(1, per // 2)
        return {"startUrls": [{"url": u} for u in urls], "maxResults": half, "maxResultsShorts": half, "maxResultStreams": 0,
                "sortVideosBy": "NEWEST", "oldestPostDate": "2 days"}
    if platform == "tiktok":
        return {"profiles": [a.lstrip("@") for a in accounts], "resultsPerPage": per, "profileSorting": "latest",
                "excludePinnedPosts": True, "oldestPostDateUnified": today}  # "today" here is the since-date passed in
    if platform == "snapchat":
        return {"usernames": [a.lstrip("@").split("/")[-1] for a in accounts], "resultType": "spotlight", "maxItems": total}
    tags = sorted({k.lstrip("#").replace(" ", "").lower() for k in keywords if re.fullmatch(r"#?[\w ]+", k)})[:10]
    if platform == "facebook_search":
        return {"categories": [k.lstrip("#") for k in keywords][:10], "searchType": "posts", "resultsLimit": total}
    if platform == "linkedin_search":
        return {"searchQueries": [k.lstrip("#") for k in keywords][:10], "maxPosts": max(1, total // max(1, min(10, len(keywords)))),
                "postedLimit": "24h", "sortBy": "date"}
    if platform == "tiktok_hashtags":  # public TikTok videos: keyword video search, past 24 hours, newest first
        qs = [k.lstrip("#") for k in keywords][:10]
        return {"searchQueries": qs, "searchSection": "/video", "videoSearchDateFilter": "PAST_24_HOURS",
                "videoSearchSorting": "LATEST", "resultsPerPage": max(1, total // max(1, len(qs)))}
    if platform == "snapchat_hashtags":
        return {"hashtags": tags, "resultsPerHashtag": max(1, total // max(1, len(tags))), "includeVideoUrls": False,
                "includeLlmMetadata": False, "includeRelatedTopics": False}
    if platform == "x_search":
        return {"searchTerms": keywords[:15], "maxItems": total, "sort": "Latest", "start": today}
    if platform == "instagram_hashtags":
        tags = sorted({k.lstrip("#").replace(" ", "").lower() for k in keywords if re.fullmatch(r"#?\w+", k)})[:20]
        return {"hashtags": tags, "resultsLimit": max(1, total // max(1, len(tags)))}
    raise ValueError(platform)


def youtube_api_channel_posts(handles, key, day_start):
    """Today's uploads from channels via the free YouTube Data API (no Apify cost)."""
    out = []
    for h in handles:
        h = h.strip()
        try:
            if "channel/" in h:
                q = {"id": h.rsplit("channel/", 1)[-1].strip("/")}
            else:
                q = {"forHandle": "@" + h.rstrip("/").rsplit("/", 1)[-1].lstrip("@")}
            ch = json.loads(http("https://www.googleapis.com/youtube/v3/channels?" + urllib.parse.urlencode({**q, "part": "contentDetails,snippet,statistics", "key": key})))
            if not ch.get("items"):
                log("youtube channel not found:", h)
                continue
            c = ch["items"][0]
            uploads = c["contentDetails"]["relatedPlaylists"]["uploads"]
            subs = int(c.get("statistics", {}).get("subscriberCount", 0) or 0)
            pl = json.loads(http("https://www.googleapis.com/youtube/v3/playlistItems?" + urllib.parse.urlencode({"playlistId": uploads, "part": "snippet,contentDetails", "maxResults": 20, "key": key})))
            for it in pl.get("items", []):
                s = it["snippet"]
                d = parse_date(it.get("contentDetails", {}).get("videoPublishedAt") or s.get("publishedAt"))
                if not d or d < day_start:
                    continue
                vid = it["contentDetails"]["videoId"]
                out.append(mention("YouTube", vid, d, s.get("channelTitle"), h, html.unescape(s.get("title", "")) + ". " + html.unescape(s.get("description", ""))[:1500],
                                   f"https://www.youtube.com/watch?v={vid}", subs, title=html.unescape(s.get("title", ""))))
        except Exception as e:
            log("youtube channel failed:", h, e)
    return out


def social_groups(st):
    """The shared Sources list plus one list per brand: (name, accounts, search terms, monthly limit)."""
    out = [("", st.get("accounts") or {}, st.get("search_terms") or [], int(st.get("monthly_limit", 5000)))]
    for name, src in sorted((st.get("brand_sources") or {}).items()):
        out.append((name, src.get("accounts") or {}, src.get("search_terms") or [], int(src.get("monthly_limit", st.get("monthly_limit", 5000)))))
    return out


def alert_keywords_by_brand():
    try:
        alerts = json.load(open(os.environ.get("SENTIMETER_SHARED", "/var/lib/sentimeter/shared.json"))).get("alerts") or []
    except Exception:
        alerts = []
    by = {}
    for al in alerts:
        by.setdefault((al.get("brand") or "").strip().lower(), []).extend(al.get("keywords") or [])
    return by


def src_social(cfg, kws, force=False):
    """Daily run. Each brand (and the shared list) has its own monthly limit and is collected separately."""
    st = load_settings()
    now_l = local_now(st.get("timezone", "Asia/Kolkata"))
    today = now_l.strftime("%Y-%m-%d")
    usage = load_usage()
    # Each run covers the time since the previous run (24 hours if there was none, at most 48),
    # so every hour is collected once and nothing is paid for twice.
    prev = parse_date(usage.get("last_run_at"))
    day_start = max(prev, NOW - timedelta(hours=48)) if prev else NOW - timedelta(hours=24)
    since = (day_start.astimezone(now_l.tzinfo)).strftime("%Y-%m-%d")  # date filter for actors
    if not force:
        hh, mm = (st.get("run_after") or "09:00").split(":")
        if now_l.hour * 60 + now_l.minute < int(hh) * 60 + int(mm) or usage.get("last_daily_run") == today:
            return "not_due"
    month = today[:7]
    mu = usage["months"].setdefault(month, {"posts": 0, "runs": []})
    if "brands" not in mu:  # usage counted before limits were per brand belongs to the shared list
        mu["brands"] = {"": {"posts": mu.get("posts", 0)}}
    days_in_month = calendar.monthrange(now_l.year, now_l.month)[1]
    days_left = days_in_month - now_l.day + 1
    ceiling = int(os.environ.get("SENTIMETER_MAX_MONTHLY") or 5000)
    actors = st["actors"]
    kw_by_brand = alert_keywords_by_brand()
    handle = lambda a: a.rstrip("/").rsplit("/", 1)[-1].lstrip("@")
    out, any_billable, no_token_everywhere = [], False, True

    for gname, gacc, gterms, glimit in social_groups(st):
        label = gname or "Shared"
        bu = mu["brands"].setdefault(gname, {"posts": 0})
        remaining = max(0, min(glimit, ceiling) - bu["posts"])
        allowance = remaining // days_left if days_left else 0
        accounts = {p: [a.strip() for a in gacc.get(p, []) if a.strip()] for p in PLATFORMS}
        terms = [s.strip() for s in gterms if s.strip()] or [k for k in kw_by_brand.get(gname.lower(), []) if k.strip()][:10]
        run_log = {"date": today, "time": now_l.strftime("%H:%M"), "group": label, "allowance": allowance, "limit": min(glimit, ceiling), "jobs": {}}
        yt_free = accounts["youtube"] and actors.get("youtube") == "youtube-data-api"
        if yt_free:  # YouTube through the free API does not use the Apify budget
            key = os.environ.get("YOUTUBE_API_KEY")
            if key:
                got = youtube_api_channel_posts(accounts["youtube"], key, day_start)
                for m in got:
                    if gname:
                        m["brands"] = [gname]
                out += got
                log(f"social [{label}] youtube (free API): {len(got)} today")
            else:
                log(f"social [{label}] youtube skipped: set YOUTUBE_API_KEY, or choose an Apify actor for YouTube")
        jobs = [p for p in PLATFORMS if accounts[p] and not (p == "youtube" and yt_free)]
        if terms:
            jobs += [k for k in KEYWORD_JOBS if st.get("keyword_search", {}).get(k)]
        mention_terms = {}  # public posts that mention a tracked profile
        if st.get("include_mentions", True):
            mention_terms = {"x_search": [f"@{handle(a)}" for a in accounts["x"]], "instagram_hashtags": [handle(a) for a in accounts["instagram"]],
                             "tiktok_hashtags": [handle(a) for a in accounts["tiktok"]]}
        if not jobs:
            continue
        any_billable = True
        if not any(token_for(p)[0] for p in jobs):
            log(f"social [{label}] skipped: add the Apify token in Sentimeter settings or /etc/sentimeter.env")
            run_log["note"] = "no Apify token"
            mu["runs"] = (mu["runs"] + [run_log])[-120:]
            continue
        no_token_everywhere = False
        if allowance < 1:
            log(f"social [{label}] skipped: monthly limit reached ({bu['posts']}/{min(glimit, ceiling)})")
            run_log["note"] = "monthly limit reached"
            mu["runs"] = (mu["runs"] + [run_log])[-120:]
            continue
        share = max(1, allowance // len(jobs))
        left = allowance
        for p in jobs:
            if left < 1:
                run_log["jobs"][p] = {"skipped": "daily allowance used"}
                continue
            total = min(share, left)
            n = len(accounts.get(p) or [1])
            per = max(1, total // n)
            actor = actors.get(p) or DEFAULT_ACTORS[p]
            token, tgroup = token_for(p)
            if not token:
                run_log["jobs"][p] = {"skipped": "no Apify token for this platform"}
                continue
            try:
                jt = terms + [m for m in mention_terms.get(p, []) if m.lower() not in {x.lower() for x in terms}]
                payload = platform_input(p, accounts.get(p, []), jt, per, total, since)
                items, billed = apify_run_capped(actor, payload, token, total)
            except Exception as e:
                log(f"social [{label}] {p} failed:", e)
                run_log["jobs"][p] = {"error": str(e)[:200], "token": tgroup}
                continue
            left -= billed
            bu["posts"] += billed
            mu["posts"] += billed
            kept = 0
            for it in items:
                try:
                    m = MAPPERS[p](it)
                except Exception:
                    continue
                if not m["text"]:
                    continue
                if p in ("x", "x_search"):
                    m["reach_basis"] = "views"
                if p in KEYWORD_JOBS:
                    m["tracked"] = False
                elif gname:
                    m["brands"] = [gname]  # a brand's own profiles: shown only in that brand's alerts
                if m["date"] >= iso(day_start):
                    out.append(m)
                    kept += 1
            run_log["jobs"][p] = {"actor": actor, "billed": billed, "kept_today": kept, "token": tgroup}
            log(f"social [{label}] {p} ({tgroup} token): {billed} results billed, {kept} since {iso(day_start)}")
        mu["runs"] = (mu["runs"] + [run_log])[-120:]
    seen = {}
    for m in out:
        k = dedupe_key(m)
        if k in seen and m.get("tracked"):
            seen[k]["tracked"] = True
            if m.get("brands") or seen[k].get("brands"):
                seen[k]["brands"] = sorted(set(seen[k].get("brands") or []) | set(m.get("brands") or []))
        seen.setdefault(k, m)
    if not (any_billable and no_token_everywhere):
        usage["last_daily_run"] = today
        usage["last_run_at"] = iso(NOW)
    save_usage(usage)
    return out

SOURCES = {"google_news": src_google_news, "bing_news": src_bing_news, "reddit": src_reddit, "bluesky": src_bluesky, "youtube": src_youtube, "apify": src_apify, "social": src_social}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", default=os.path.join(ROOT, "fetcher/config.json"))
    ap.add_argument("--out", default=os.path.join(DATA_DIR, "mentions.json"))
    ap.add_argument("--only", default="")
    ap.add_argument("--skip", default="")
    ap.add_argument("--force", action="store_true", help="ignore schedules (every_hours, daily run time)")
    a = ap.parse_args()
    lock = open(LOCK_PATH, "w")
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        log("another fetch is running; exiting")
        return
    cfg = json.load(open(a.config))
    kws, excl_words = list(cfg["keywords"]), list(cfg.get("excluded", []))
    alert_kws = list(kws)
    try:  # follow the keywords of the alerts people edit on the site
        shared = json.load(open(os.environ.get("SENTIMETER_SHARED", "/var/lib/sentimeter/shared.json")))
        alerts = shared.get("alerts") or []
        if alerts:
            alert_kws = sorted({k for al in alerts for k in al.get("keywords", [])}, key=str.lower)
            kws = list(alert_kws)  # news, YouTube and keyword searches use only alert keywords
            excl_words = sorted({k for al in alerts for k in al.get("excluded", [])})
    except Exception:
        pass
    excl = [kw_regex(k) for k in excl_words]
    # keep only posts that contain an alert keyword or hashtag: nothing is stored without one
    need = [kw_regex(k) for k in alert_kws if k.strip()]
    has_kw = lambda m: any(r.search((m.get("title") or "") + " " + (m.get("text") or "")) for r in need)
    news_on = load_settings().get("news", {})
    for name in ("google_news", "bing_news"):
        if name in news_on:
            cfg.setdefault(name, {})["enabled"] = bool(news_on[name])
    only = set(filter(None, a.only.split(",")))
    skip = set(filter(None, a.skip.split(",")))

    old = {"mentions": [], "sources": {}}
    if os.path.exists(a.out):
        try:
            old = json.load(open(a.out))
        except Exception:
            log("existing data unreadable, starting fresh")
    byid, keys = {}, {}
    for m in old.get("mentions", []):  # also collapses duplicates stored before
        for f_ in ("author", "handle", "text", "title", "location", "url", "platform", "date"):
            if f_ in m and not isinstance(m[f_], str):
                m[f_] = as_text(m[f_])
        k = dedupe_key(m)
        if k in keys:
            continue
        keys[k] = m["id"]
        byid[m["id"]] = m
    dupes = len(old.get("mentions", [])) - len(byid)
    if dupes:
        log(f"removed {dupes} duplicate posts already stored")
    status = old.get("sources", {})

    for name, fn in SOURCES.items():
        scfg = cfg.get(name, {})
        if not scfg.get("enabled") or (only and name not in only) or name in skip:
            continue
        every = scfg.get("every_hours")
        last = parse_date(status.get(name, {}).get("last_run"))
        if every and last and not a.force and NOW - last < timedelta(hours=every) - timedelta(minutes=5):
            continue
        t0 = time.time()
        skip_kw = {s.lower() for s in scfg.get("skip_keywords", [])}
        try:
            kw2 = [k for k in kws if k.lower() not in skip_kw]
            got = fn(scfg, kw2, a.force) if name == "social" else fn(scfg, kw2)
        except Exception as e:
            log(name, "crashed:", e)
            got = []
        if got == "not_due":
            continue
        if got is None:
            status[name] = {"last_run": status.get(name, {}).get("last_run"), "ok": False, "count": 0, "note": "needs an API key"}
            continue
        new = dup = old_n = no_kw = 0
        news_cut = iso(NOW - timedelta(hours=24))
        for m in got:
            if not m.get("text") or any(r.search(m["text"]) for r in excl):
                continue
            if not has_kw(m):
                no_kw += 1
                continue
            if name in ("google_news", "bing_news") and m["date"] < news_cut:
                old_n += 1
                continue
            k = dedupe_key(m)
            mid_ = m["id"] if m["id"] in byid else keys.get(k)
            if mid_:
                cur = byid[mid_]
                dup += 1
                if m["id"] == mid_:
                    was_tracked = cur.get("tracked") or m.get("tracked")
                    byid[mid_] = {**cur, **{f: v for f, v in m.items() if v not in (None, "")}}
                    if was_tracked:
                        byid[mid_]["tracked"] = True
                elif cur.get("platform") == "X" and m.get("reach_basis") == "views" and cur.get("reach_basis") != "views":
                    cur["reach"], cur["reach_basis"] = int(m.get("reach") or 0), "views"
                    if m.get("tracked"):
                        cur["tracked"] = True
                else:
                    cur["reach"] = max(int(cur.get("reach") or 0), int(m.get("reach") or 0))
                    if m.get("tracked"):
                        cur["tracked"] = True
                continue
            keys[k] = m["id"]
            byid[m["id"]] = m
            new += 1
        status[name] = {"last_run": iso(NOW), "ok": bool(got), "count": len(got), "new": new, "duplicates": dup}
        log(f"{name}: {len(got)} fetched, {new} new, {dup} already tracked" + (f", {old_n} older than 24h skipped" if old_n else "") + (f", {no_kw} without a keyword dropped" if no_kw else "") + f", {time.time()-t0:.0f}s")

    for m in byid.values():
        if m.get("platform") == "X" and m.get("reach_basis") != "views":
            m["reach"], m["reach_basis"] = 0, "views"  # was the author's follower count; X reach is now post views
    cutoff = iso(NOW - timedelta(days=cfg.get("keep_days", 45)))
    ms = sorted((m for m in byid.values() if m.get("date", "") >= cutoff and has_kw(m) and not any(r.search(m.get("text") or "") for r in excl)), key=lambda m: m["date"], reverse=True)[: cfg.get("max_mentions", 6000)]
    os.makedirs(os.path.dirname(a.out), exist_ok=True)
    tmp = a.out + ".tmp"
    with open(tmp, "w") as f:
        u = load_usage()
        st = load_settings()
        month = local_now(st.get("timezone", "Asia/Kolkata")).strftime("%Y-%m")
        social = {"month": month, "used": u.get("months", {}).get(month, {}).get("posts", 0), "limit": min(int(st.get("monthly_limit", 5000)), int(os.environ.get("SENTIMETER_MAX_MONTHLY") or 5000)),
                  "last_daily_run": u.get("last_daily_run"), "last_run": (u.get("months", {}).get(month, {}).get("runs") or [None])[-1]}
        json.dump({"updated": iso(NOW), "keywords": kws, "sources": status, "social": social, "mentions": ms}, f, ensure_ascii=False, separators=(",", ":"))
    os.replace(tmp, a.out)
    log(f"wrote {len(ms)} mentions to {a.out}")


if __name__ == "__main__":
    main()
