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
import argparse, email.utils, hashlib, html, json, os, re, sys, time, urllib.parse, urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
UA = "Sentimeter/1.0 (social listening; +https://sentimeter.starkpeople.in)"
NOW = datetime.now(timezone.utc)


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


SOURCES = {"google_news": src_google_news, "reddit": src_reddit, "bluesky": src_bluesky, "youtube": src_youtube, "apify": src_apify}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", default=os.path.join(ROOT, "fetcher/config.json"))
    ap.add_argument("--out", default=os.path.join(ROOT, "public/data/mentions.json"))
    ap.add_argument("--only", default="")
    ap.add_argument("--force", action="store_true", help="ignore every_hours schedules")
    a = ap.parse_args()
    cfg = json.load(open(a.config))
    kws, excl = cfg["keywords"], [kw_regex(k) for k in cfg.get("excluded", [])]
    only = set(filter(None, a.only.split(",")))

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
        if not scfg.get("enabled") or (only and name not in only):
            continue
        every = scfg.get("every_hours")
        last = parse_date(status.get(name, {}).get("last_run"))
        if every and last and not a.force and NOW - last < timedelta(hours=every) - timedelta(minutes=5):
            continue
        t0 = time.time()
        skip = {s.lower() for s in scfg.get("skip_keywords", [])}
        try:
            got = fn(scfg, [k for k in kws if k.lower() not in skip])
        except Exception as e:
            log(name, "crashed:", e)
            got = []
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
        json.dump({"updated": iso(NOW), "keywords": kws, "sources": status, "mentions": ms}, f, ensure_ascii=False, separators=(",", ":"))
    os.replace(tmp, a.out)
    log(f"wrote {len(ms)} mentions to {a.out}")


if __name__ == "__main__":
    main()
