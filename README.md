# Sentimeter

Sentiment analysis and social listening for social media and digital platforms: keyword alerts, a sentiment dashboard, individual mention pages, and mention-statistics reports. It runs entirely in the browser; imported data stays on the viewer's device.

Live: https://sentimeter.starkpeople.in

## How the tool is organised

Pick a **brand** at the top of the sidebar; every page works for that brand:

- **Dashboard** (home): reach, engagements, mentions and positive sentiment with change vs the previous period, performance chart, sentiment donut, upcoming posts, competitor table and recent mentions.
- **Publish & Schedule**: write a post once for Facebook, Instagram, YouTube, X and LinkedIn, add images, preview it per platform (desktop or mobile), see the brand's best time to publish (from its past posts), then save as a draft, schedule or queue it. Posts and images are saved on the server; actual posting starts once each platform grants publishing permission (until then "Publish now" is disabled and scheduled posts are not sent).
- **Content Calendar**: scheduled posts and what went live, by month.
- **Analytics** (+ Platform reports): the brand's own accounts (official APIs, or Apify public data).
- **Sentiment Analysis**, **Listening & Mentions**: the brand's listening alerts (the alert list shows on these pages).
- **Competitor Analysis**: domestic and international competitors, monthly followers, growth and charts.
- **Reports**: the weekly, monthly or quarterly deck (PDF or PowerPoint) and the sentiment report.
- **Workspace**: all brands, brand settings, sources & keys, analyze text.

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

### Monthly report

Each brand has a **Monthly report** tab that builds a 16:9 slide deck in the standard Stark template (the same for every brand):

1. Cover: brand logo, "Social Media Report", month, Stark logo (black background, so a white or light brand logo works best).
2. **Overall Performance dashboard**: reach, impressions, engagements, video views, link clicks (LinkedIn only), followers gained, posts published and average engagement rate for the reporting period.
3. **Platform-wise performance** table: reach, impressions, engagements, engagement rate and lifetime followers per platform.
4. One slide per platform (Facebook, Instagram, each YouTube channel, LinkedIn): headline numbers with change against the same days of the previous month, and daily charts.
5. **Post-wise performance**, two posts per slide: Facebook & Instagram together (a post shared on both, captions matched within 3 days, is shown once with each platform's reach and engagement), YouTube videos separately, LinkedIn separately.
6. Thank you slide.

Pick the month at the top (the current month shows "to date"), sort posts by date, engagement or reach, or keep only the top 10/20. **Download PDF** saves the deck as a 16:9 PDF; **Download PPT** saves an editable PowerPoint (.pptx) with native charts and tables. Both are built in the browser with libraries kept in `public/vendor/` (PptxGenJS, html2canvas-pro, jsPDF; MIT licence).

Upload the brand logo in the brand's **Settings > Brand**. Post images are saved on the server during sync because the platforms' image links expire. Syncs keep post history (up to about 400 days).

Reach is Facebook/Instagram reach and LinkedIn unique impressions; impressions are views for Facebook, Instagram and YouTube. Engagement is reactions + comments + shares (Facebook), total interactions (Instagram), clicks + reactions + comments + shares (LinkedIn) and likes + comments + shares (YouTube, daily) or likes + comments (per video).

### Brand-specific report sections (weekly report, X, listening, competitors)

In a brand's **Settings > Report** you can switch on extra parts of the report deck for that brand only:

- **Weekly report**: adds a Monday-to-Sunday report next to the monthly one (the tab becomes "Weekly & monthly report"). Changes are compared with the previous week.
- **Channel handles**: a "Management of SM Channels" slide with the brand's Facebook, Instagram, X, LinkedIn and YouTube handles.
- **X (Twitter) analytics**: the brand's public X posts (views, likes, reposts, replies, quotes, bookmarks) and follower count, collected once a day after 9:00 with the Apify actor `apidojo~tweet-scraper` (token `APIFY_TOKEN_X_LINKEDIN`, else `APIFY_TOKEN`; about 40 posts a run). Adds an X platform slide and X post-wise slides.
- **Listening & sentiment**: uses one of your listening alerts: top UGC (highest-reach posts by other accounts), sentiment split and net score, tracked keywords with mention counts, mentions and reach per day, top countries, top hashtags, and negative posts. Listening data is kept for 100 days (up to 20,000 mentions).
- **Competitor analysis**: a competitor list (national and international groups; "Fill sample list" adds the 7 Indian and 15 international tourism boards from the Karnataka Tourism report) and Facebook/Instagram follower comparison charts with the brand highlighted. Follower counts are collected once a month with `apify~facebook-pages-scraper` and `apify~instagram-profile-scraper` (token `APIFY_TOKEN_META`, else `APIFY_TOKEN`), one lookup per handle. Settings shows the name each account reports so you can check the handle, and any count can be corrected by hand.

Data is stored in `/var/lib/sentimeter/sma/<brand>/x.json` and `competitors.json`.

### Weekly, monthly and quarterly reports

Every brand's **Report deck** tab makes weekly (Monday–Sunday), monthly and quarterly (calendar quarters) decks in the Stark template, each compared with the previous period. Quarterly decks show the top 20 posts per platform by default (change it with the "Posts shown" picker). Instagram's daily statistics only go back 30 days from the first sync, so the first quarters fill in as history builds up.

### Brand sections in Mentions

In an alert's settings, set **Brand** (for example "Karnataka Tourism") and **Section**, a name you choose (for example Domestic, International, Themes); names already used are suggested so alerts group together. Alerts with the same brand are grouped under it in the sidebar, with an "all sections" view on top and a **+** button to add a section. In the brand's Settings > Report, choose "All <brand> sections" as the listening alert to get a **Mentions by section** slide (mentions, change, reach, positive/negative share and net sentiment per section). The fetcher collects every alert's keywords, so new sections are collected automatically.

### Reach

Listening reach is the sum of each mention's reach: X post views (not the author's followers), YouTube/TikTok/Snapchat views, Facebook and LinkedIn likes + comments + shares, Instagram likes + comments, Bluesky likes + reposts, Reddit subreddit subscribers, and 0 for news. X posts stored before this change had follower counts and are reset to 0 (no view count was saved).

### Keywords only

Nothing is collected or shown without a keyword. The collector searches news, YouTube and the public-post searches with your alerts' keywords and hashtags, and stores a post only if its title or text contains one of them (older stored posts without one are removed on the next run). Posts from tracked profiles on the Sources page follow the same rule, and an alert shows a mention only when it contains one of that alert's keywords.

### Sources per brand

The Sources page has a **Sources for** picker: "Shared (all alerts)" or a brand (brands come from alert settings and Social Media Analytics). Each brand can have its own tracked profiles and search terms. Posts from a brand's profiles are tagged with that brand and appear only in alerts with that brand; posts from shared profiles appear in every alert that includes brand profiles, as before. Each brand has its own **monthly limit** (posts per month, set on the Sources page with that brand selected; the shared list's limit is the default for new brands) and is collected separately in the daily run within its own allowance, so one brand cannot use up another's budget. A brand's public-post searches use its own search terms, or its alerts' keywords if it has none. Actors, news sources, Apify tokens and the run time stay shared.

### Apify integration (shared by all brands)

Each brand's Settings has an **Apify integration** card: tick Facebook, Instagram, X, LinkedIn, YouTube or TikTok to collect the brand's public posts (likes, comments, shares, views where shown) and follower count once a day after 9:00, using the brand handles from Settings > Report. It uses the Apify tokens on the Sources page (API keys), which every brand shares; the Brands page shows which tokens are set and this month's results. The official LinkedIn, Facebook/Instagram and YouTube integrations are unchanged: a report uses the official API when it is connected and Apify only otherwise (Apify slides are labelled "public data"). Each run collects up to 30 new posts per platform (60 on the first run). Actors: `apify~facebook-posts-scraper`, `apify~instagram-post-scraper` (plus the page/profile scrapers for follower counts), `apidojo~tweet-scraper`, `harvestapi~linkedin-profile-posts`, `streamers~youtube-scraper`, `clockworks~tiktok-scraper`.

### Scale

Mentions are kept for 100 days (up to 20,000). The mentions file is served gzip-compressed with an ETag, so browsers only download it again when it has changed.

## Competitor Analysis (tab)

The **Competitors** tab (main menu) tracks each brand's competitors month by month:

- Pick a brand and click **Edit competitors & handles**: the brand's own handles plus national and international competitors, each with Facebook, Instagram, X, LinkedIn and YouTube handles (handle or profile link). "Fill sample list" adds 7 Indian and 15 international tourism boards.
- Follower counts are collected once a month after 9:00 (or with **Refresh followers now**), one lookup per handle: Facebook `apify~facebook-pages-scraper`, Instagram `apify~instagram-profile-scraper` (token for Facebook & Instagram), X `apidojo~twitter-user-scraper`, LinkedIn `harvestapi~linkedin-company` (token for X & LinkedIn), YouTube through the free YouTube Data API key when set, else `streamers~youtube-scraper`.
- The **Followers** table shows each account's followers for the chosen month and growth against the previous collected month (number and %), with totals; the brand is pinned and highlighted. **Monthly history** shows the last 12 months per platform. **Correct numbers** lets you fix a count by hand; **Copy table (CSV)** exports it.
- Report decks with the Competitor analysis section get comparison charts for every platform that has data.

Data: `/var/lib/sentimeter/sma/<brand>/competitors.json` (one snapshot per month).

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
