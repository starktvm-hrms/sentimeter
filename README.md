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

The **Sources** page lists accounts to follow on Facebook, Instagram, X, LinkedIn, YouTube, TikTok and Snapchat, the Apify actor used for each, optional keyword search on X and Instagram, and a monthly post limit (default 1,000 across all actors).

- The hourly fetch runs the social job once a day, after 23:00 India time, and keeps only that day's posts.
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

Set up once on the VPS (after `setup-fetcher.sh`):

```bash
bash /var/www/sentimeter/deploy/setup-sources.sh
```

It installs `fetcher/admin.py` as the `sentimeter-admin` service on 127.0.0.1:8787, forwards `/api/` to it from nginx, and prints the admin key the Sources page asks for. Settings are stored in `/etc/sentimeter/settings.json`, usage in `/var/lib/sentimeter/usage.json`, keys in `/etc/sentimeter.env`.

## Importing data

Use **Alert settings → Data → Import CSV or JSON**. Recognised columns: text (or content, mention, message, comment, review, body), platform/source, date, author, handle, location/country, language, reach/followers, url, title, gender, age, account_type.
