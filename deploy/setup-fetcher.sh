#!/usr/bin/env bash
# One-time setup on the VPS (run as root, after setup-vps.sh): hourly mention fetching.
# Usage: sudo bash /var/www/sentimeter/deploy/setup-fetcher.sh
set -euo pipefail
DIR="/var/www/sentimeter"
ENV_FILE="/etc/sentimeter.env"
command -v python3 >/dev/null || apt-get install -y python3

# API keys live here, outside the repository. Both are optional:
#   YOUTUBE_API_KEY  free key from Google Cloud Console (YouTube Data API v3)
#   APIFY_TOKEN      Apify account token, enables X and Instagram (paid per use)
if [ ! -f "$ENV_FILE" ]; then
  printf '# Sentimeter fetcher keys (optional)\nYOUTUBE_API_KEY=\nAPIFY_TOKEN=\n' > "$ENV_FILE"
fi
chmod 600 "$ENV_FILE"

mkdir -p "$DIR/public/data" /var/log/sentimeter
chown -R www-data:www-data "$DIR/public/data"

cat > /usr/local/bin/sentimeter-fetch <<SH
#!/usr/bin/env bash
set -a; [ -f $ENV_FILE ] && . $ENV_FILE; set +a
exec /usr/bin/python3 $DIR/fetcher/fetch.py "\$@"
SH
chmod 755 /usr/local/bin/sentimeter-fetch

# Every hour at minute 17. Google News, Reddit and Bluesky run each time;
# YouTube every 3 hours and Apify every 6 (set in fetcher/config.json).
echo "17 * * * * root /usr/local/bin/sentimeter-fetch >> /var/log/sentimeter/fetch.log 2>&1" > /etc/cron.d/sentimeter-fetch

echo "First run (takes about a minute)..."
/usr/local/bin/sentimeter-fetch --force
chown www-data:www-data "$DIR/public/data/mentions.json"
echo "Done. Data: https://sentimeter.starkpeople.in/data/mentions.json · Log: /var/log/sentimeter/fetch.log"
echo "Add API keys to $ENV_FILE to turn on YouTube, X and Instagram."
