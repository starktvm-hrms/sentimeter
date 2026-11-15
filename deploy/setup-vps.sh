#!/usr/bin/env bash
# One-time setup on the VPS (run as root): clone, nginx vhost, HTTPS, auto-update.
# Usage: sudo bash setup-vps.sh https://github.com/OWNER/REPO.git [branch] [email-for-letsencrypt]
set -euo pipefail
REPO_URL="${1:?Pass the repository clone URL}"
BRANCH="${2:-main}"
EMAIL="${3:-}"
DOMAIN="sentimeter.starkpeople.in"
DIR="/var/www/sentimeter"

command -v git >/dev/null || apt-get install -y git
if [ -d "$DIR/.git" ]; then
  git -C "$DIR" fetch --quiet origin "$BRANCH" && git -C "$DIR" reset --quiet --hard "origin/$BRANCH"
else
  git clone --quiet --branch "$BRANCH" "$REPO_URL" "$DIR"
fi
chown -R www-data:www-data "$DIR"

cp "$DIR/deploy/nginx-sentimeter.conf" "/etc/nginx/sites-available/$DOMAIN"
ln -sf "/etc/nginx/sites-available/$DOMAIN" "/etc/nginx/sites-enabled/$DOMAIN"
nginx -t && systemctl reload nginx

command -v certbot >/dev/null || apt-get install -y certbot python3-certbot-nginx
if [ -n "$EMAIL" ]; then
  certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "$EMAIL" --redirect
else
  certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --register-unsafely-without-email --redirect
fi

# Pull new commits every 5 minutes (static site: no build needed on the server).
cat > /etc/cron.d/sentimeter-deploy <<CRON
*/5 * * * * root git -C $DIR fetch --quiet origin $BRANCH && [ "\$(git -C $DIR rev-parse HEAD)" != "\$(git -C $DIR rev-parse origin/$BRANCH)" ] && git -C $DIR reset --quiet --hard origin/$BRANCH && chown -R www-data:www-data $DIR
CRON
echo "Done: https://$DOMAIN"
