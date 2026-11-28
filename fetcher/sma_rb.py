"""Custom Report Builder: saved reports, templates and their uploaded images/videos.

Storage (server only):
  /var/lib/sentimeter/sma/reports/<id>.json   one report or template (the full editable document)
  /var/lib/sentimeter/sma/reports/index.json  list for the reports page (name, kind, brand, pages, updated)
  /var/lib/sentimeter/sma/rb_assets/<id>.<ext> images and videos placed in reports

Documents are written through /api/upload/ (nginx allows large bodies only there) because a
multi-page report with many widgets can exceed the 64 KB limit of the other API routes.
"""
import json, os, re, secrets, shutil, threading, time

import sma

LOCK = threading.Lock()
MAX_DOC = 8 * 1024 * 1024
IMAGE_TYPES = {"image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp", "image/gif": ".gif"}
VIDEO_TYPES = {"video/mp4": ".mp4", "video/webm": ".webm", "video/quicktime": ".mov"}
MAX_IMAGE = 15 * 1024 * 1024
MAX_VIDEO = 500 * 1024 * 1024
MAGIC = (b"\x89PNG", b"\xff\xd8\xff", b"RIFF", b"GIF8")


def _dir(*p):
    return sma._p("reports", *p)


def _adir(*p):
    return sma._p("rb_assets", *p)


def _index():
    return sma._load(_dir("index.json"), {"items": []}).get("items") or []


def _save_index(items):
    sma._save(_dir("index.json"), {"items": items}, 0o640)


def list_reports():
    return sorted(_index(), key=lambda r: r.get("updated") or "", reverse=True)


def get_report(rid):
    if not re.fullmatch(r"r[0-9a-f]{10}", rid or ""):
        raise KeyError("Report not found")
    d = sma._load(_dir(rid + ".json"), None)
    if d is None:
        raise KeyError("Report not found")
    return d


def save_report(rid, raw, user):
    if len(raw) > MAX_DOC:
        raise ValueError("This report is too large to save (over 8 MB). Remove some pages or large images.")
    try:
        doc = json.loads(raw or b"{}")
    except Exception:
        raise ValueError("The report could not be read.")
    if not isinstance(doc, dict) or not isinstance(doc.get("pages"), list):
        raise ValueError("The report has no pages.")
    if not 1 <= len(doc["pages"]) <= 200:
        raise ValueError("A report has 1 to 200 pages.")
    for pg in doc["pages"]:
        if not isinstance(pg, dict) or not isinstance(pg.get("elements", []), list) or len(pg.get("elements", [])) > 600:
            raise ValueError("A page has too many elements (600 at most).")
    name = str(doc.get("name") or "").strip()[:120] or "Untitled report"
    kind = "template" if doc.get("kind") == "template" else "report"
    brand = str(doc.get("brand") or "")
    if brand and not sma.get_brand(brand):
        brand = ""
    with LOCK:
        items = _index()
        if rid == "new":
            rid = "r" + secrets.token_hex(5)
        elif not re.fullmatch(r"r[0-9a-f]{10}", rid or "") or not any(i["id"] == rid for i in items):
            raise KeyError("Report not found")
        cur = next((i for i in items if i["id"] == rid), None)
        now = sma.iso()
        doc.update({"id": rid, "name": name, "kind": kind, "brand": brand, "updated": now, "updated_by": user,
                    "created": (cur or {}).get("created") or doc.get("created") or now, "created_by": (cur or {}).get("created_by") or user})
        os.makedirs(_dir(), exist_ok=True)
        sma._save(_dir(rid + ".json"), doc, 0o640)
        entry = {"id": rid, "name": name, "kind": kind, "brand": brand, "pages": len(doc["pages"]),
                 "period": (doc.get("period") or {}).get("label", ""), "template_for": str(doc.get("template_for") or "")[:40],
                 "updated": now, "updated_by": user, "created": doc["created"], "created_by": doc["created_by"]}
        items = [i for i in items if i["id"] != rid] + [entry]
        _save_index(items)
    return doc


def delete_report(rid):
    if not re.fullmatch(r"r[0-9a-f]{10}", rid or ""):
        raise KeyError("Report not found")
    with LOCK:
        _save_index([i for i in _index() if i["id"] != rid])
        try:
            os.remove(_dir(rid + ".json"))
        except FileNotFoundError:
            pass


# ---------------- assets ----------------

def save_asset(stream, length, ctype):
    ctype = (ctype or "").split(";")[0].strip().lower()
    if ctype in IMAGE_TYPES:
        ext, limit = IMAGE_TYPES[ctype], MAX_IMAGE
    elif ctype in VIDEO_TYPES:
        ext, limit = VIDEO_TYPES[ctype], MAX_VIDEO
    else:
        raise ValueError("Upload a PNG, JPG, WebP or GIF image, or an MP4, WebM or MOV video.")
    if length <= 0:
        raise ValueError("The file is empty.")
    if length > limit:
        raise ValueError(f"The file is larger than {limit // 1048576} MB.")
    os.makedirs(_adir(), exist_ok=True)
    if shutil.disk_usage(_adir()).free - length < 1024 ** 3:
        raise ValueError("The server is short of disk space for this file.")
    aid = "a" + secrets.token_hex(8)
    path = _adir(aid + ext)
    left, head = length, b""
    try:
        with open(path + ".part", "wb") as f:
            while left > 0:
                chunk = stream.read(min(1048576, left))
                if not chunk:
                    raise ValueError("The upload was interrupted. Try again.")
                if not head:
                    head = chunk[:16]
                f.write(chunk)
                left -= len(chunk)
        ok = head.startswith(MAGIC) if ctype in IMAGE_TYPES else (head[4:8] == b"ftyp" or head.startswith(b"\x1aE\xdf\xa3"))
        if not ok:
            raise ValueError("That file is not a valid image or video.")
        os.replace(path + ".part", path)
    except BaseException:
        try:
            os.remove(path + ".part")
        except FileNotFoundError:
            pass
        raise
    return aid + ext


def asset_path(name):
    if not re.fullmatch(r"a[0-9a-f]{16}\.(png|jpg|webp|gif|mp4|webm|mov)", name or ""):
        return None
    p = _adir(name)
    return p if os.path.exists(p) else None


def asset_type(path):
    ext = os.path.splitext(path)[1]
    return next((k for k, v in {**IMAGE_TYPES, **VIDEO_TYPES}.items() if v == ext), "application/octet-stream")
