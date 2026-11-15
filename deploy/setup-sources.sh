#!/usr/bin/env bash
# One-time setup on the VPS (run as root, after setup-vps.sh and setup-fetcher.sh):
# the settings service behind the site's Sources page, and the daily social-account run.
# Usage: bash /var/www/sentimeter/deploy/setup-sources.sh
set -euo pipefail
DIR="/var/www/sentimeter"
ENV_FILE="/etc/sentimeter.env"
SITE="/etc/nginx/sites-available/sentimeter.starkpeople.in"

mkdir -p /etc/sentimeter /var/lib/sentimeter /var/log/sentimeter
touch "$ENV_FILE"; chmod 600 "$ENV_FILE"

# Admin key for the Sources page (generated once).
if ! grep -q '^SENTIMETER_ADMIN_KEY=.\{24,\}' "$ENV_FILE"; then
  sed -i '/^SENTIMETER_ADMIN_KEY=/d' "$ENV_FILE"
  echo "SENTIMETER_ADMIN_KEY=$(openssl rand -hex 24)" >> "$ENV_FILE"
fi
grep -q '^APIFY_TOKEN=' "$ENV_FILE" || echo "APIFY_TOKEN=" >> "$ENV_FILE"

# Settings service (localhost only; nginx forwards /api/ to it).
cat > /etc/systemd/system/sentimeter-admin.service <<UNIT
[Unit]
Description=Sentimeter settings service
After=network.target

[Service]
ExecStart=/usr/bin/python3 $DIR/fetcher/admin.py
Restart=on-failure
NoNewPrivileges=true
PrivateTmp=false

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now sentimeter-admin
systemctl restart sentimeter-admin

# nginx: include the /api/ and /data/ locations in both server blocks of the site.
cp "$DIR/deploy/nginx-sentimeter-api.conf" /etc/nginx/snippets/sentimeter-api.conf
if ! grep -q 'snippets/sentimeter-api.conf' "$SITE"; then
  cp "$SITE" "/root/sentimeter-nginx-backup-$(date +%Y%m%d%H%M%S).conf"
  sed -i 's|^\(\s*\)server_name sentimeter.starkpeople.in;|&\n\1include /etc/nginx/snippets/sentimeter-api.conf;|' "$SITE"
fi
if ! nginx -t; then
  echo "nginx config test failed; restoring the backup" >&2
  cp "$(ls -t /root/sentimeter-nginx-backup-*.conf | head -1)" "$SITE"
  exit 1
fi
systemctl reload nginx

# Auto-update from GitHub every 5 minutes; restart the settings service when code changes.
cat > /etc/cron.d/sentimeter-deploy <<CRON
*/5 * * * * root git -C $DIR fetch --quiet origin main && [ "\$(git -C $DIR rev-parse HEAD)" != "\$(git -C $DIR rev-parse origin/main)" ] && git -C $DIR reset --quiet --hard origin/main && chown -R www-data:www-data $DIR && systemctl try-restart sentimeter-admin
CRON

# The hourly fetch (setup-fetcher.sh) also runs the daily social job after 23:00 India time.
sleep 1
curl -fsS -o /dev/null -w "Settings service: HTTP %{http_code} (401 is expected without a key)\n" https://sentimeter.starkpeople.in/api/settings || true
echo
echo "Admin key for the Sources page (keep it private):"
grep '^SENTIMETER_ADMIN_KEY=' "$ENV_FILE" | cut -d= -f2
