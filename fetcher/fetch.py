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
                            "lang": t.get("lang", ""), "reach": int(a.get("followers") or 0)})
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
KEYWORD_JOBS = ["x_search", "instagram_hashtags", "facebook_search", "linkedin_search", "tiktok_hashtags", "snapchat_hashtags"]
DEFAULT_SEARCH_TERMS = ["#keralatourism", "Kerala tourism", "Munnar", "Varkala", "Kovalam", "Kumarakom", "Wayanad", "Kerala backwaters"]
DEFAULT_SETTINGS = {
    "accounts": {p: [] for p in PLATFORMS},
    "actors": dict(DEFAULT_ACTORS),
    "keyword_search": {k: False for k in ["x_search", "instagram_hashtags", "facebook_search", "linkedin_search", "tiktok_hashtags", "snapchat_hashtags"]},
    "search_terms": ["#keralatourism", "Kerala tourism", "Munnar", "Varkala", "Kovalam", "Kumarakom", "Wayanad", "Kerala backwaters"],
    "monthly_limit": 1000,
    "run_after": "23:00",
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
    url = "https://api.apify.com/v2" + path
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
    try:
        billed = int(apify_call(f"/datasets/{ds}", token)["data"].get("itemCount") or len(items))
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


def mention(platform, key, date, author, handle, text, url, reach, location="", title=""):
    d = parse_date(date) if not isinstance(date, datetime) else date
    return {"id": mid(platform[:2], str(key or url or text)), "date": iso(d or NOW), "platform": platform, "author": author or handle or platform,
            "handle": handle or "", "location": location or "", "title": title or "", "text": text, "url": url or "", "reach": reach, "tracked": True}


MAPPERS = {
    "facebook": lambda i: mention("Facebook", g(i, "postId", "id", "url"), g(i, "time", "timestamp", "date"), g(i, "pageName", "user.name", "authorName"),
                                  g(i, "pageName", "user.id"), g(i, "text", "message", "postText"), g(i, "url", "topLevelUrl"),
                                  num(g(i, "likes", default=0), g(i, "comments", default=0), g(i, "shares", default=0))),
    "instagram": lambda i: mention("Instagram", g(i, "id", "shortCode", "url"), g(i, "timestamp"), g(i, "ownerFullName", "ownerUsername"), g(i, "ownerUsername"),
                                   g(i, "caption"), g(i, "url"), num(g(i, "likesCount", default=0), g(i, "commentsCount", default=0)), g(i, "locationName")),
    "instagram_hashtags": lambda i: MAPPERS["instagram"](i),
    "x": lambda i: mention("X", g(i, "id", "url"), g(i, "createdAt"), g(i, "author.name", "author.userName"), g(i, "author.userName"),
                           g(i, "fullText", "text"), g(i, "url", "twitterUrl"), num(g(i, "author.followers", default=0)), g(i, "author.location")),
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
                "sortVideosBy": "NEWEST", "oldestPostDate": "1 day"}
    if platform == "tiktok":
        return {"profiles": [a.lstrip("@") for a in accounts], "resultsPerPage": per, "profileSorting": "latest",
                "excludePinnedPosts": True, "oldestPostDateUnified": today}
    if platform == "snapchat":
        return {"usernames": [a.lstrip("@").split("/")[-1] for a in accounts], "resultType": "spotlight", "maxItems": total}
    tags = sorted({k.lstrip("#").replace(" ", "").lower() for k in keywords if re.fullmatch(r"#?[\w ]+", k)})[:10]
    if platform == "facebook_search":
        return {"categories": [k.lstrip("#") for k in keywords][:10], "searchType": "posts", "resultsLimit": total}
    if platform == "linkedin_search":
        return {"searchQueries": [k.lstrip("#") for k in keywords][:10], "maxPosts": max(1, total // max(1, min(10, len(keywords)))),
                "postedLimit": "24h", "sortBy": "date"}
    if platform == "tiktok_hashtags":
        return {"hashtags": tags, "resultsPerPage": max(1, total // max(1, len(tags))), "excludePinnedPosts": True}
    if platform == "snapchat_hashtags":
        return {"hashtags": tags, "resultsPerHashtag": max(1, total // max(1, len(tags))), "includeVideoUrls": False,
                "includeLlmMetadata": False, "includeRelatedTopics": False}
    if platform == "x_search":
        return {"searchTerms": keywords, "maxItems": total, "sort": "Latest", "start": today}
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


def src_social(cfg, kws, force=False):
    st = load_settings()
    token = os.environ.get("APIFY_TOKEN", "")
    now_l = local_now(st.get("timezone", "Asia/Kolkata"))
    today = now_l.strftime("%Y-%m-%d")
    day_start = now_l.replace(hour=0, minute=0, second=0, microsecond=0).astimezone(timezone.utc)
    usage = load_usage()
    if not force:
        hh, mm = (st.get("run_after") or "23:00").split(":")
        if now_l.hour * 60 + now_l.minute < int(hh) * 60 + int(mm) or usage.get("last_daily_run") == today:
            return "not_due"
    month = today[:7]
    mu = usage["months"].setdefault(month, {"posts": 0, "runs": []})
    days_in_month = calendar.monthrange(now_l.year, now_l.month)[1]
    days_left = days_in_month - now_l.day + 1
    ceiling = int(os.environ.get("SENTIMETER_MAX_MONTHLY") or 1000)
    remaining = max(0, min(int(st.get("monthly_limit", 1000)), ceiling) - mu["posts"])
    allowance = remaining // days_left if days_left else 0

    accounts = {p: [a.strip() for a in st["accounts"].get(p, []) if a.strip()] for p in PLATFORMS}
    actors = st["actors"]
    out = []
    # YouTube through the free API does not use the Apify budget
    yt_free = accounts["youtube"] and actors.get("youtube") == "youtube-data-api"
    if yt_free:
        key = os.environ.get("YOUTUBE_API_KEY")
        if key:
            got = youtube_api_channel_posts(accounts["youtube"], key, day_start)
            out += got
            log(f"social youtube (free API): {len(got)} today")
        else:
            log("social youtube skipped: set YOUTUBE_API_KEY, or choose an Apify actor for YouTube")
    jobs = [p for p in PLATFORMS if accounts[p] and not (p == "youtube" and yt_free)]
    jobs += [k for k in KEYWORD_JOBS if st.get("keyword_search", {}).get(k)]
    terms = [s.strip() for s in st.get("search_terms") or [] if s.strip()] or kws[:10]
    run_log = {"date": today, "allowance": allowance, "jobs": {}}
    if jobs and not token:
        log("social skipped: add the Apify token in Sentimeter settings or /etc/sentimeter.env")
        run_log["note"] = "no Apify token"
    elif jobs and allowance < 1:
        log(f"social skipped: monthly limit reached ({mu['posts']}/{st.get('monthly_limit')})")
        run_log["note"] = "monthly limit reached"
    elif jobs:
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
            try:
                payload = platform_input(p, accounts.get(p, []), terms, per, total, today)
                items, billed = apify_run_capped(actor, payload, token, total)
            except Exception as e:
                log(f"social {p} failed:", e)
                run_log["jobs"][p] = {"error": str(e)[:200]}
                continue
            left -= billed
            mu["posts"] += billed
            kept = 0
            for it in items:
                try:
                    m = MAPPERS[p](it)
                except Exception:
                    continue
                if not m["text"]:
                    continue
                if p in KEYWORD_JOBS:
                    m["tracked"] = False
                if m["date"] >= iso(day_start):
                    out.append(m)
                    kept += 1
            run_log["jobs"][p] = {"actor": actor, "billed": billed, "kept_today": kept}
            log(f"social {p}: {billed} results billed, {kept} from today")
    mu["runs"] = (mu["runs"] + [run_log])[-62:]
    if run_log.get("note") != "no Apify token":
        usage["last_daily_run"] = today
    save_usage(usage)
    return out

SOURCES = {"google_news": src_google_news, "reddit": src_reddit, "bluesky": src_bluesky, "youtube": src_youtube, "apify": src_apify, "social": src_social}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", default=os.path.join(ROOT, "fetcher/config.json"))
    ap.add_argument("--out", default=os.path.join(ROOT, "public/data/mentions.json"))
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
    kws, excl = cfg["keywords"], [kw_regex(k) for k in cfg.get("excluded", [])]
    only = set(filter(None, a.only.split(",")))
    skip = set(filter(None, a.skip.split(",")))

    old = {"mentions": [], "sources": {}}
    if os.path.exists(a.out):
        try:
            old = json.load(open(a.out))
        except Exception:
            log("existing data unreadable, starting fresh")
    byid = {m["id"]: m for m in old.get("mentions", [])}
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
        new = 0
        for m in got:
            if not m.get("text") or any(r.search(m["text"]) for r in excl):
                continue
            if m["id"] not in byid:
                new += 1
            byid[m["id"]] = {**byid.get(m["id"], {}), **{k: v for k, v in m.items() if v not in (None, "")}}
        status[name] = {"last_run": iso(NOW), "ok": bool(got), "count": len(got), "new": new}
        log(f"{name}: {len(got)} fetched, {new} new, {time.time()-t0:.0f}s")

    cutoff = iso(NOW - timedelta(days=cfg.get("keep_days", 45)))
    ms = sorted((m for m in byid.values() if m.get("date", "") >= cutoff), key=lambda m: m["date"], reverse=True)[: cfg.get("max_mentions", 6000)]
    os.makedirs(os.path.dirname(a.out), exist_ok=True)
    tmp = a.out + ".tmp"
    with open(tmp, "w") as f:
        u = load_usage()
        st = load_settings()
        month = local_now(st.get("timezone", "Asia/Kolkata")).strftime("%Y-%m")
        social = {"month": month, "used": u.get("months", {}).get(month, {}).get("posts", 0), "limit": st.get("monthly_limit", 1000),
                  "last_daily_run": u.get("last_daily_run"), "last_run": (u.get("months", {}).get(month, {}).get("runs") or [None])[-1]}
        json.dump({"updated": iso(NOW), "keywords": kws, "sources": status, "social": social, "mentions": ms}, f, ensure_ascii=False, separators=(",", ":"))
    os.replace(tmp, a.out)
    log(f"wrote {len(ms)} mentions to {a.out}")


if __name__ == "__main__":
    main()
