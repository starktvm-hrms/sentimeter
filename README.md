# Sentimeter

Sentiment analysis and social listening for social media and digital platforms: keyword alerts, a sentiment dashboard, individual mention pages, and mention-statistics reports. It runs entirely in the browser; imported data stays on the viewer's device.

Live: https://sentimeter.starkpeople.in

## Project layout

| Path | What it is |
| --- | --- |
| `src/app.template.html` | The app (UI, charts, alerts, reports). `/*ENGINE*/` marks where the scorer goes. |
| `src/engine.js` | Lexicon-based sentiment scorer (VADER-style: emoji, slang, negation, boosters, "but" shifts). |
| `build.py` | Builds `public/index.html` from `src/`. |
| `public/index.html` | The built, self-contained site that the server serves. Commit it after building. |
| `deploy/` | nginx config and one-time VPS setup script. |

## Make a change

```bash
python3 build.py
git add -A && git commit -m "Describe the change" && git push
```

The VPS pulls `main` every 5 minutes, so the change is live within 5 minutes of the push.

## Server setup (once)

On the VPS (Hostinger KVM 2, nginx), as root:

```bash
curl -fsSLO https://raw.githubusercontent.com/OWNER/REPO/main/deploy/setup-vps.sh
sudo bash setup-vps.sh https://github.com/OWNER/REPO.git main you@example.com
```

It clones the repo to `/var/www/sentimeter`, adds the nginx site, gets a Let's Encrypt certificate and installs the 5-minute auto-update cron job. For a private repository, add the server's SSH key as a read-only deploy key and pass the SSH clone URL instead.

DNS: `sentimeter.starkpeople.in` is an A record pointing to the VPS (76.13.241.150).

## Live data (real mentions)

`fetcher/fetch.py` collects public mentions for the keywords in `fetcher/config.json` and writes `public/data/mentions.json`, which the site loads on start. On the server it runs every hour from cron.

| Source | Needs | Notes |
| --- | --- | --- |
| Google News | nothing | English, Malayalam and Hindi editions for India |
| Bing News | nothing | India market, one search per keyword |
| Reddit | nothing | may be rate limited from some servers |
| Bluesky | nothing | public post search |
| YouTube | `YOUTUBE_API_KEY` | free key; runs every 3 hours to stay inside the daily quota |
| X and Instagram | `APIFY_TOKEN` | via Apify actors, paid per use; runs every 6 hours |
| Facebook | not supported | Meta does not offer public post search |

Set it up once on the VPS, after `setup-vps.sh`:

```bash
sudo bash /var/www/sentimeter/deploy/setup-fetcher.sh
```

Keys go in `/etc/sentimeter.env` on the server (never in this repository). To change what is collected, edit `fetcher/config.json` and push; the next hourly run picks it up. Run it by hand with `sudo sentimeter-fetch --force`; the log is `/var/log/sentimeter/fetch.log`.

The collected data is served publicly at `/data/mentions.json`, like the site itself. Add HTTP basic auth in nginx if the dashboard should be private.

## Tracked social accounts (Sources page)

The **Sources** page lists accounts to follow on Facebook, Instagram, X, LinkedIn, YouTube, TikTok and Snapchat, the Apify actor used for each, optional keyword search on X, Instagram, Facebook, LinkedIn, TikTok and Snapchat (using one shared list of up to 10 search terms), and a monthly post limit (default 5,000 across all actors).

- The settings service starts the social collection every day at 09:00 India time (changeable on the Sources page). Each run collects posts published since the previous run (24 hours for the first run, at most 48), so every hour is covered once and nothing is billed twice. The hourly fetch is a backup if the 09:00 start is missed.
- Each day's allowance is what is left of the monthly limit divided by the days left in the month. Every Apify run is started with `maxItems` set to that allowance, so Apify itself stops there. Results that turn out to be older than today still count, because Apify bills for them.
- YouTube channels use the free YouTube Data API when the actor is `youtube-data-api` (default), so they do not use the Apify limit.
- Posts from tracked accounts appear in every alert unless the alert's "Tracked accounts" box is unticked.

| Platform | Default actor |
| --- | --- |
| Facebook | `apify~facebook-posts-scraper` |
| Instagram | `apify~instagram-post-scraper` |
| X | `apidojo~tweet-scraper` |
| LinkedIn | `harvestapi~linkedin-profile-posts` |
| YouTube | `youtube-data-api` (free) or `streamers~youtube-scraper` |
| TikTok | `clockworks~tiktok-scraper` |
| Snapchat | `parseforge~snapchat-scraper` |
| X keyword search | `apidojo~tweet-scraper` |
| Instagram hashtags | `apify~instagram-hashtag-scraper` |
| Facebook post search | `apify~facebook-search-scraper` |
| LinkedIn post search | `harvestapi~linkedin-post-search` |
| TikTok search (public videos, past 24 hours) | `clockworks~tiktok-scraper` |
| Snapchat hashtags (experimental) | `w3crawler~snapchat-hashtag-scraper` |

Set up once on the VPS (after `setup-fetcher.sh`):

```bash
bash /var/www/sentimeter/deploy/setup-sources.sh
```

It installs `fetcher/admin.py` as the `sentimeter-admin` service on 127.0.0.1:8787 and forwards `/api/` to it from nginx. Settings are stored in `/etc/sentimeter/settings.json`, usage in `/var/lib/sentimeter/usage.json`, keys in `/etc/sentimeter.env`.

## Profile posts and public posts

Sentimeter collects two kinds of social posts:

- **Profile posts**: everything the brand profiles on the Sources page publish. They appear in every alert and are marked "Profile post".
- **Public posts**: anyone's posts that match the search terms (X, Instagram, Facebook, LinkedIn, TikTok, Snapchat searches). With "Brand mentions" on, X search also looks for `@handle` of each tracked X profile, and Instagram and TikTok searches include the tracked usernames. Public posts appear in alerts whose keywords they match.

The Mentions page filters them with "Profile posts" and "Public posts".

## Apify tokens per platform

Three Apify tokens split the work, shared by every brand on the site:

| Token (`/etc/sentimeter.env`) | Runs |
| --- | --- |
| `APIFY_TOKEN_META` | Facebook and Instagram accounts, Facebook post search, Instagram hashtags |
| `APIFY_TOKEN_X_LINKEDIN` | X and LinkedIn accounts, X keyword search, LinkedIn post search |
| `APIFY_TOKEN_OTHER` | YouTube (when an Apify actor is used), TikTok and Snapchat |
| `APIFY_TOKEN` | Default for any group without its own token |

Set them on the Sources page under API keys. The monthly post limit is one total across all tokens.

## News and duplicates

News (Google News and Bing News) is checked every hour for any alert keyword or Sources search term, keeps articles from the last 24 hours, and does not count toward the Apify limit. Both can be switched off on the Sources page.

Each post is stored once. News articles are identified by headline, so the same article from both sources, several searches or several Google News editions is one mention. Social posts are identified by their URL without tracking parameters, or by author and text when there is no URL. A post found by both account tracking and keyword search is stored once and keeps the "Tracked" mark. Apify still bills for a result returned twice in a day, so avoid tracking an account and also searching for terms it always uses.

## Social Media Analytics

The **Social Media Analytics** tab holds **brands**. Each brand has four sections:

- **Platform**: one card per platform with connection status and 30-day figures. LinkedIn, Facebook, Instagram and YouTube are live; X is next.
- **Report**: LinkedIn page analytics for 7, 30, 90 or 365 days: followers and new followers, impressions, unique impressions, engagement rate, clicks, reactions, comments, reposts, page views, daily charts, top posts and follower demographics, compared with the previous period. Copy as CSV or print / save as PDF.
- **Source**: the connected company page, who connected it and when, token expiry, granted permissions, API version, stored data range and sync history. Sync now, re-sync 12 months, or disconnect.
- **Settings**: brand name, and the LinkedIn API integration (setup guide, redirect URL, Client ID, Client Secret, scopes, API version, Connect LinkedIn, page choice).

### Facebook and Instagram setup (Meta Graph API)

1. The brand's Instagram must be a Professional (Business or Creator) account linked to its Facebook Page.
2. Create an app of type **Business** at https://developers.facebook.com/apps and add **Facebook Login for Business**.
3. Under Facebook Login > Settings, add the Valid OAuth Redirect URI `https://sentimeter.starkpeople.in/api/sma/meta/callback`.
4. Give everyone who will connect Pages an admin or developer role on the app (no app review is needed for your own Pages while the app is in development mode).
5. Paste the App ID and App Secret (App settings > Basic) in the brand's Settings, save, click **Connect Facebook & Instagram**, and choose the Page.

Permissions requested: `pages_show_list pages_read_engagement read_insights business_management instagram_basic instagram_manage_insights`. The short-lived login is exchanged for a 60-day token and then a Page token, which does not expire while the admin keeps the app's permissions. Each statistic is requested on its own with the newer Meta name first (for example `page_media_view`, then `page_impressions`), so retired metrics show as unavailable instead of failing the sync. Facebook keeps up to 12 months of daily history on first sync; Instagram provides only the last 30 days, so its history grows from the first sync. Code: `fetcher/sma_meta.py`; data in `/var/lib/sentimeter/sma/<brand>/meta.json`.

### YouTube setup (YouTube Analytics API + Data API)

1. In Google Cloud (console.cloud.google.com), enable **YouTube Data API v3** and **YouTube Analytics API** in a project.
2. Configure the OAuth consent screen (Google Auth Platform): **Internal** if the channel's Google account is in your Google Workspace, otherwise **External** with the channel's account as a test user. While the publishing status is **Testing**, Google ends connections after 7 days; publish the app for a lasting connection.
3. Create an **OAuth client ID** of type **Web application** with the redirect URI `https://sentimeter.starkpeople.in/api/sma/youtube/callback`.
4. Paste the Client ID and Client Secret in the brand's Settings, save, click **Connect YouTube**, and pick the channel's account (or Brand Account) in Google's chooser.
5. A brand can have several channels: **Add another channel** runs the Google sign-in again for the next channel. The Channels list shows each one with **Use for reports** and **Remove**; the Report and Source tabs have a channel selector, and every channel syncs daily.

Scopes: `youtube.readonly` and `yt-analytics.readonly`. Sentimeter keeps a refresh token on the server and renews the hourly access token itself. It stores up to 12 months of daily views, watch time, average view duration and percentage, subscribers gained and lost, likes, comments and shares; 90-day traffic sources, countries, age, gender, devices and format (videos, Shorts, live); top videos for 28, 90 and 365 days; and recent uploads. YouTube Analytics runs about two days behind. Code: `fetcher/sma_youtube.py`; data in `/var/lib/sentimeter/sma/<brand>/youtube_<channel>.json` (one file per channel).

### LinkedIn setup

1. Create an app at https://www.linkedin.com/developers/apps linked to the brand's company page (a page admin verifies it).
2. Request the **Community Management API** product for the app.
3. Add the redirect URL `https://sentimeter.starkpeople.in/api/sma/linkedin/callback` in the app's Auth tab.
4. Paste the Client ID and Client Secret in the brand's Settings, save, and click **Connect LinkedIn** as a page admin.

The first connection pulls up to 12 months of daily statistics; after that the brand syncs daily at the Sources run time (and on demand). Access tokens last 60 days and renew automatically when LinkedIn issues a refresh token; otherwise the Source tab shows when to reconnect.

Storage (server only): brands in `/var/lib/sentimeter/sma/brands.json`, client secrets and tokens in `/var/lib/sentimeter/sma/secrets.json` (mode 600), synced data in `/var/lib/sentimeter/sma/<brand>/linkedin.json`. Code: `fetcher/sma.py`.

## Login

The homepage (`#home`) is public. Everything else (dashboard, mentions, reports, Sources, and the data) needs a login.

- Users are stored in `/var/lib/sentimeter/users.json` with scrypt password hashes (file mode 600). Sessions last 30 days (`/var/lib/sentimeter/sessions.json`, HttpOnly, Secure, SameSite=Lax cookie).
- Collected data lives in `/var/lib/sentimeter/data/` and is served only to logged-in users through `/api/data/`. It is no longer in the public web folder.
- Login attempts are limited to 8 per 15 minutes per visitor.
- The first admin is created once through `POST /api/auth/setup` with a one-time secret (only its SHA-256 is in `fetcher/admin.py`). Setup is refused once a user exists.
- The `SENTIMETER_ADMIN_KEY` bearer key still works for scripts.

## Shared use

Everyone who logs in shares the same settings and edits on any device:

- Alerts, label corrections, stars, tags, deleted posts and blocked authors are stored on the server (`/var/lib/sentimeter/shared.json`) and shared by everyone.
- Imported files are uploaded to the server (`public/data/imported.json`) and shown to everyone.

Safeguards that apply to everyone, set in `/etc/sentimeter.env`:

| Variable | Default | Effect |
| --- | --- | --- |
| `SENTIMETER_MAX_MONTHLY` | 5000 | Highest monthly post limit the Sources page can set |
| `SENTIMETER_MAX_USD_PER_RUN` | 1 | Apify cost cap for each actor run (`maxTotalChargeUsd`) |

Manual runs are limited to one every 30 minutes, and changes are rate limited per visitor.

## Importing data

Use **Alert settings → Data → Import CSV or JSON**. Recognised columns: text (or content, mention, message, comment, review, body), platform/source, date, author, handle, location/country, language, reach/followers, url, title, gender, age, account_type.
