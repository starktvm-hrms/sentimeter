"""Publishing to X (Twitter) with the official X API v2.

Flow: each brand saves its X app's OAuth 2.0 Client ID and Client Secret (developer.x.com > app >
User authentication settings: Web App / confidential client, callback below) -> "Connect X" runs the
OAuth 2.0 authorization-code flow with PKCE -> access token (2 hours) + refresh token
(offline.access; X rotates it on every refresh, so the new one is always stored).

Posting: images go to POST /2/media/upload (media.write), then POST /2/tweets with up to 4 media ids.

Secrets (client secret, access and refresh tokens) stay in secrets.json (mode 600) and never leave
the server. Non-secret state is in the brand record under "xpub".
"""
import base64, hashlib, json, os, re, secrets as pysecrets, threading, time, urllib.error, urllib.parse, urllib.request

import sma

AUTH = os.environ.get("SENTIMETER_X_AUTH_URL", "https://x.com/i/oauth2/authorize")
API = os.environ.get("SENTIMETER_X_API_BASE", "https://api.x.com").rstrip("/")
REDIRECT_PATH = "/api/sma/x/callback"
SCOPES = "tweet.read tweet.write users.read media.write offline.access"
STATES = {}   # state -> {brand, email, verifier, exp}
REFRESH_LOCK = threading.Lock()   # one refresh at a time: X invalidates the old refresh token


def redirect_uri():
    return sma.PUBLIC_URL + REDIRECT_PATH


def cfg(b):
    return (b or {}).get("xpub") or {}


def _upd(bid, **kv):
    sma.update_brand_record(bid, lambda r: r.setdefault("xpub", {}).update(kv))


def public(b):
    x = dict(cfg(b))
    sec = sma.secrets_all().get(b["id"], {})
    x["has_client_secret"] = bool(sec.get("x_client_secret"))
    x["connected"] = bool(sec.get("x_refresh_token") or sec.get("x_access_token"))
    x["redirect_uri"] = redirect_uri()
    granted = str(x.get("granted_scopes") or "").split()
    x["can_post"] = x["connected"] and "tweet.write" in granted
    x["can_post_media"] = x["can_post"] and "media.write" in granted
    return x


def update(bid, body):
    x = body.get("xpub")
    if not x:
        return
    errors, changes = [], {}
    if "client_id" in x:
        v = str(x["client_id"]).strip()
        if v and not re.fullmatch(r"[A-Za-z0-9_\-]{10,80}", v):
            errors.append("X Client ID looks wrong: copy the OAuth 2.0 Client ID from the app's Keys and tokens tab.")
        changes["client_id"] = v
    sec = str(x.get("client_secret") or "").strip()
    if sec and not re.fullmatch(r"[A-Za-z0-9_\-]{20,120}", sec):
        errors.append("X Client Secret has unexpected characters.")
    if errors:
        raise ValueError(" ".join(errors))
    _upd(bid, **changes)
    if sec:
        sma.set_secrets(bid, x_client_secret=sec)


def friendly(msg):
    low = str(msg or "").lower()
    if "redirect" in low or "callback" in low:
        return "X rejected the callback URL. In the app's User authentication settings, add exactly: " + redirect_uri()
    if "access_denied" in low:
        return "The X sign-in was cancelled. Click Connect X to try again."
    if "unauthorized_client" in low or "invalid_client" in low:
        return ("X did not accept the Client ID or Client Secret. Copy the OAuth 2.0 Client ID and Secret again (Keys and tokens), and check "
                "that the app type is Web App with Read and write permissions.")
    if "invalid_request" in low and "refresh" in low or "invalid_grant" in low:
        return "X ended the connection for this brand. Click Connect X again in Brand settings."
    if "usage" in low and ("cap" in low or "limit" in low) or "too many requests" in low or "429" in low:
        return "X's posting limit for this app's plan has been reached. Try later, or upgrade the X API plan."
    if "client-not-enrolled" in low or "client forbidden" in low or "not permitted" in low or "attached to a project" in low:
        return "X refused the request for this app. Check that the app is inside a Project with API access and has Read and write permissions."
    if "duplicate" in low:
        return "X rejected this post as a duplicate of a recent one."
    return "X: " + str(msg)[:300]


def start(bid, email):
    b = sma.get_brand(bid)
    if not b:
        raise KeyError("Brand not found")
    x = cfg(b)
    if not x.get("client_id") or not sma.secret(bid, "x_client_secret"):
        raise ValueError("Save the X Client ID and Client Secret first.")
    state = pysecrets.token_urlsafe(24)
    verifier = pysecrets.token_urlsafe(48)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    now = time.time()
    for k in [k for k, v in STATES.items() if v["exp"] < now]:
        STATES.pop(k, None)
    STATES[state] = {"brand": bid, "email": email, "verifier": verifier, "exp": now + 600}
    q = urllib.parse.urlencode({"response_type": "code", "client_id": x["client_id"], "redirect_uri": redirect_uri(), "scope": SCOPES,
                                "state": state, "code_challenge": challenge, "code_challenge_method": "S256"})
    return f"{AUTH}?{q}"


def _token_post(bid, form):
    x = cfg(sma.get_brand(bid))
    basic = base64.b64encode(f"{x.get('client_id', '')}:{sma.secret(bid, 'x_client_secret') or ''}".encode()).decode()
    req = urllib.request.Request(f"{API}/2/oauth2/token", data=urllib.parse.urlencode({**form, "client_id": x.get("client_id", "")}).encode(),
                                 headers={"Content-Type": "application/x-www-form-urlencoded", "Authorization": f"Basic {basic}"})
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
    sma.set_secrets(bid, x_access_token=tok["access_token"], x_refresh_token=tok.get("refresh_token") or sma.secret(bid, "x_refresh_token"),
                    x_access_expires=time.time() + int(tok.get("expires_in") or 7200) - 120)
    if tok.get("scope"):
        _upd(bid, granted_scopes=tok["scope"])


def callback(params, email):
    st = STATES.pop(params.get("state", ""), None)
    if not st or st["exp"] < time.time():
        return None, "The X sign-in expired or was started elsewhere. Click Connect X again."
    bid = st["brand"]
    if params.get("error"):
        msg = friendly(params.get("error_description") or params["error"])
        _upd(bid, last_error=msg)
        return bid, msg
    try:
        tok = _token_post(bid, {"grant_type": "authorization_code", "code": params.get("code", ""), "redirect_uri": redirect_uri(),
                                "code_verifier": st["verifier"]})
        _store(bid, tok)
        me = api(bid, "GET", "/2/users/me").get("data") or {}
        _upd(bid, user_id=me.get("id", ""), username=me.get("username", ""), name=me.get("name", ""), connected_at=sma.iso(),
             connected_by=email, last_error="", granted_scopes=tok.get("scope") or SCOPES)
        return bid, None
    except Exception as e:
        _upd(bid, last_error=str(e)[:300])
        return bid, str(e)


def disconnect(bid):
    sma.set_secrets(bid, x_access_token=None, x_refresh_token=None, x_access_expires=None)
    _upd(bid, user_id="", username="", name="", connected_at=None, connected_by=None, granted_scopes="")


def access_token(bid):
    sec = sma.secrets_all().get(bid, {})
    if sec.get("x_access_token") and (sec.get("x_access_expires") or 0) > time.time():
        return sec["x_access_token"]
    if not sec.get("x_refresh_token"):
        raise RuntimeError("The X connection expired. Click Connect X again in Brand settings.")
    with REFRESH_LOCK:
        sec = sma.secrets_all().get(bid, {})
        if sec.get("x_access_token") and (sec.get("x_access_expires") or 0) > time.time():
            return sec["x_access_token"]
        tok = _token_post(bid, {"grant_type": "refresh_token", "refresh_token": sec["x_refresh_token"]})
        _store(bid, tok)
        return tok["access_token"]



def api(bid, method, path, body=None, raw=None, ctype=None):
    headers = {"Authorization": f"Bearer {access_token(bid)}", "Accept": "application/json"}
    data = None
    if body is not None:
        data, headers["Content-Type"] = json.dumps(body).encode(), "application/json"
    elif raw is not None:
        data, headers["Content-Type"] = raw, ctype
    req = urllib.request.Request(API + path, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=90) as r:
            return json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        txt = e.read().decode(errors="replace")[:600]
        try:
            j = json.loads(txt)
            txt = j.get("detail") or j.get("title") or ((j.get("errors") or [{}])[0]).get("message") or txt
        except Exception:
            pass
        raise RuntimeError(friendly(f"{txt} ({e.code})" if e.code == 429 else txt))


def _multipart(fields, file_field, filename, content, ctype):
    bnd = "----sentimeter" + pysecrets.token_hex(12)
    out = b""
    for k, v in fields.items():
        out += f"--{bnd}\r\nContent-Disposition: form-data; name=\"{k}\"\r\n\r\n{v}\r\n".encode()
    out += f"--{bnd}\r\nContent-Disposition: form-data; name=\"{file_field}\"; filename=\"{filename}\"\r\nContent-Type: {ctype}\r\n\r\n".encode()
    out += content + f"\r\n--{bnd}--\r\n".encode()
    return out, f"multipart/form-data; boundary={bnd}"


def upload_image(bid, raw, ctype):
    data, mp = _multipart({"media_category": "tweet_image"}, "media", "image" + {"image/png": ".png", "image/webp": ".webp"}.get(ctype, ".jpg"), raw, ctype)
    r = api(bid, "POST", "/2/media/upload", raw=data, ctype=mp)
    mid = (r.get("data") or {}).get("id") or r.get("media_id_string") or r.get("media_id")
    if not mid:
        raise RuntimeError("X did not return a media id for the image.")
    return str(mid)


def publish(bid, text, images):
    """images: list of (bytes, content_type). Returns (tweet_id, url)."""
    b = sma.get_brand(bid)
    x = public(b)
    if images and not x.get("can_post_media"):
        raise RuntimeError("X was connected without image permission (media.write). Click Connect X again in Brand settings.")
    ids = [upload_image(bid, raw, ct) for raw, ct in images[:4]]
    body = {"text": text}
    if ids:
        body["media"] = {"media_ids": ids}
    r = api(bid, "POST", "/2/tweets", body=body)
    tid = (r.get("data") or {}).get("id")
    if not tid:
        raise RuntimeError("X did not confirm the post.")
    user = cfg(sma.get_brand(bid)).get("username") or "i"
    return tid, f"https://x.com/{user}/status/{tid}"


def weighted_len(text):
    """X counts most characters as 1, CJK/emoji as 2, and every link as 23."""
    text = re.sub(r"https?://\S+", "x" * 23, text or "")
    n = 0
    for ch in text:
        o = ord(ch)
        n += 1 if (o <= 0x10FF or 0x2000 <= o <= 0x200D or 0x2010 <= o <= 0x201F or 0x2032 <= o <= 0x2037) else 2
    return n
