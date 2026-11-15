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

## Public, shared use

The site is open to everyone, with no login, and works the same on every device:

- Sources settings, API keys (write-only), and "Run today's collection now" need no key.
- Alerts, label corrections, stars, tags, deleted posts and blocked authors are stored on the server (`/var/lib/sentimeter/shared.json`) and shared by everyone.
- Imported files are uploaded to the server (`public/data/imported.json`) and shown to everyone.

Safeguards that apply to everyone, set in `/etc/sentimeter.env`:

| Variable | Default | Effect |
| --- | --- | --- |
| `SENTIMETER_MAX_MONTHLY` | 5000 | Highest monthly post limit the Sources page can set |
| `SENTIMETER_MAX_USD_PER_RUN` | 1 | Apify cost cap for each actor run (`maxTotalChargeUsd`) |
| `SENTIMETER_REQUIRE_KEY` | unset | Set to `1` to require the admin key again |

Manual runs are limited to one every 30 minutes, and changes are rate limited per visitor.

## Importing data

Use **Alert settings → Data → Import CSV or JSON**. Recognised columns: text (or content, mention, message, comment, review, body), platform/source, date, author, handle, location/country, language, reach/followers, url, title, gender, age, account_type.
