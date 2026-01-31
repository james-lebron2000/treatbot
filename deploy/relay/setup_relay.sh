#!/usr/bin/env bash

set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "This script must be run as root on the relay host" >&2
  exit 1
fi

DOMAIN=${DOMAIN:-findclinicaltrial.org}
EMAIL=${LETSENCRYPT_EMAIL:-admin@${DOMAIN}}
PROJECT_ROOT=${PROJECT_ROOT:-/opt/trial-match}
NGINX_CONF=${PROJECT_ROOT}/deploy/relay/nginx-${DOMAIN}.conf
TARGET_CONF=/etc/nginx/sites-available/${DOMAIN}.conf

apt-get update
apt-get install -y nginx certbot python3-certbot-nginx fail2ban autossh

mkdir -p "${PROJECT_ROOT}"/logs

if [[ ! -f "${NGINX_CONF}" ]]; then
  echo "Nginx config template not found at ${NGINX_CONF}" >&2
  exit 1
fi

cp "${NGINX_CONF}" "${TARGET_CONF}"
ln -sf "${TARGET_CONF}" /etc/nginx/sites-enabled/${DOMAIN}.conf

nginx -t
systemctl reload nginx

certbot --nginx --non-interactive --agree-tos --email "${EMAIL}" -d "${DOMAIN}"

systemctl reload nginx

cat <<'EOF' >/etc/cron.d/certbot-renew
0 3 * * * root certbot renew --quiet --post-hook "systemctl reload nginx"
EOF

systemctl restart nginx

echo "Relay setup complete for ${DOMAIN}."
