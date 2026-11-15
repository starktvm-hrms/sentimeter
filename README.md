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

## Importing data

Use **Alert settings → Data → Import CSV or JSON**. Recognised columns: text (or content, mention, message, comment, review, body), platform/source, date, author, handle, location/country, language, reach/followers, url, title, gender, age, account_type.
