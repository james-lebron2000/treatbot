# Dual-End Deployment Guide

This directory contains scripts and configuration required to run the clinical trial platform in a production-style topology:

* **Local Mac (development/ingress)** – runs Next.js frontend, Node.js medical API, Python OCR service, Redis + Celery, and maintains reverse tunnels to the relay.
* **Relay Ubuntu host** – exposes the public domain, terminates TLS, and forwards traffic back through the tunnels.

If you want a simpler single-host deployment first, use Docker Compose: `deploy/DOCKER_COMPOSE.md`.

## 1. Prepare environment variables

1. Copy `.env.production.example` to `.env.production` and populate the values (database URI, JWT secret, domain, etc.).
2. Copy `autossh.env.example` to `autossh.env` and update the remote host/user along with local/remote port mappings.

```
cp deploy/.env.production.example deploy/.env.production
cp deploy/autossh.env.example deploy/autossh.env
```

## 2. Start local services (Mac)

1. Install dependencies (Node.js, npm, python3, pm2, Redis, autossh).
2. Execute the helper script:

```
chmod +x deploy/start_local_services.sh
./deploy/start_local_services.sh
```

This will install npm packages, build the Next.js frontend, create a Python virtual environment for the OCR service, install pip dependencies, and start all processes via PM2 (`ecosystem.config.js`).

3. To stop services, use `pm2 stop all` or `pm2 delete <name>` and shut down Redis if necessary.

## 3. Maintain reverse tunnels

### macOS Launch Agent

1. Copy `deploy/autossh.plist` to `~/Library/LaunchAgents/org.clinicalmatch.autossh.plist`.
2. Replace placeholders (`${REMOTE_FRONTEND_PORT}`, etc.) or export them via environment variables before loading.
3. Load the agent:

```
launchctl load ~/Library/LaunchAgents/org.clinicalmatch.autossh.plist
launchctl start org.clinicalmatch.autossh
```

### Linux (systemd)

1. Copy `deploy/autossh.service` and `deploy/autossh.env` to the host (update paths inside the service file).
2. Enable the service:

```
sudo cp deploy/autossh.service /etc/systemd/system/autossh.service
sudo cp deploy/autossh.env /etc/default/autossh
sudo systemctl daemon-reload
sudo systemctl enable --now autossh
```

## 4. Configure the relay server (Ubuntu 22.04)

1. Clone or sync this repository to `/opt/trial-match` on the relay.
2. Run the setup script as root:

```
sudo DOMAIN=findclinicaltrial.org PROJECT_ROOT=/opt/trial-match bash deploy/relay/setup_relay.sh
```

This installs Nginx, Certbot, Fail2ban, deploys the HTTPS configuration (`deploy/relay/nginx-findclinicaltrial.org.conf`), and acquires a TLS certificate. Adjust the domain, email, and project path as needed.

3. Verify the reverse tunnel is forwarding traffic to ports `8300/8501/8502/8503` and that `https://findclinicaltrial.org` responds correctly.

## 5. Health checks

Use the helper script to validate both local and remote endpoints:

```
./deploy/healthcheck.sh
```

This issues `curl` requests against the local services and the remote domain. Integrate this command with cron/CI to detect regressions.

## 6. Logs and troubleshooting

* **PM2** – `pm2 logs <name>` to inspect service output; `pm2 save` to persist across restarts.
* **OCR service** – `/Users/<you>/trial-match/logs/ocr-service-local.log` (configurable).
* **Nginx** – `/var/log/nginx/findclinicaltrial.org.{access,error}.log` on the relay.
* **Reverse tunnel** – autossh logs in `~/Library/Logs/autossh.*.log` (macOS) or `journalctl -u autossh` (Linux).

## 7. Operational checklist

- [ ] `.env.production` updated with production secrets.
- [ ] `deploy/start_local_services.sh` executed successfully (frontend build, backend/ocr running).
- [ ] `autossh` tunnels established and persistent.
- [ ] Relay Nginx config deployed and TLS certificate issued.
- [ ] `deploy/healthcheck.sh` returns all OK.
- [ ] Cloudflare/ DNS points `${DOMAIN}` to the relay IP in Full (strict) mode.

With these artifacts in place the platform operates in a dual-end configuration: the Mac handles application workloads, while the relay server presents a stable, TLS-terminated public endpoint.
