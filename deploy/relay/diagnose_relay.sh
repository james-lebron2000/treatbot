#!/usr/bin/env bash
set -euo pipefail

DOMAIN="${DOMAIN:-findclinicaltrial.org}"

echo "=== Relay quick diagnose (${DOMAIN}) ==="
echo

echo "[1] Nginx status"
systemctl is-active nginx || true
systemctl is-enabled nginx || true
echo

echo "[2] Nginx config test"
nginx -t
echo

echo "[3] Listening ports (expect 8300/8501/8502 when tunnel is up)"
if command -v ss >/dev/null 2>&1; then
  ss -lntp | egrep ':(8300|8501|8502)\s' || true
else
  netstat -lntp 2>/dev/null | egrep ':(8300|8501|8502)\s' || true
fi
echo

echo "[4] Tail nginx error log"
tail -n 50 "/var/log/nginx/${DOMAIN}.error.log" || true
echo

echo "[5] Curl upstream health (local loopback)"
for u in \
  "http://127.0.0.1:8300" \
  "http://127.0.0.1:8502/api/health" \
  "http://127.0.0.1:8501/health" \
; do
  echo "curl $u"
  curl -fsS --max-time 3 "$u" >/dev/null && echo "  OK" || echo "  FAIL"
done

