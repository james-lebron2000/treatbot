# 中转隧道（relay）调试手册（沿用既有端口规划）

目标：让 `https://findclinicaltrial.org` 的 Nginx 能通过 **SSH 反向隧道** 访问你本机/算力机上的服务。

## 端口与路由约定（既有 deploy 参数）

Relay（中转机）Nginx（`deploy/relay/nginx-findclinicaltrial.org.conf`）默认：

- `/` → `127.0.0.1:8300`（前端）
- `/api/` → `127.0.0.1:8502`（后端 API）
- `/ocr/` → `127.0.0.1:8501`（Python OCR）

对应需要建立的反向隧道：

- `-R 8300:localhost:${LOCAL_FRONTEND_PORT}`
- `-R 8502:localhost:${LOCAL_MEDICAL_PORT}`
- `-R 8501:localhost:${LOCAL_OCR_PORT}`

## A. 本机（服务侧）检查

1) 确认本机端口可访问（示例）：

```bash
curl -fsS "http://127.0.0.1:${LOCAL_FRONTEND_PORT:-3000}/api/health"
curl -fsS "http://127.0.0.1:${LOCAL_MEDICAL_PORT:-5002}/api/health"
curl -fsS "http://127.0.0.1:${LOCAL_OCR_PORT:-5001}/health"
```

2) 如果你用 `docker-compose` 跑服务，并且想沿用既有 relay 端口规划：

```bash
docker compose -f docker-compose.yml -f docker-compose.relay.yml up -d --build
```

## B. 建立隧道（本机 → relay）

推荐先用手动命令验证（成功后再上 autossh/launchd/systemd）：

```bash
ssh -N \
  -o ServerAliveInterval=30 \
  -o ServerAliveCountMax=3 \
  -o ExitOnForwardFailure=yes \
  -R 8300:localhost:${LOCAL_FRONTEND_PORT:-3000} \
  -R 8501:localhost:${LOCAL_OCR_PORT:-5001} \
  -R 8502:localhost:${LOCAL_MEDICAL_PORT:-5002} \
  -p ${AUTOSSH_SSH_PORT:-22} \
  -i ${SSH_IDENTITY_FILE:-$HOME/.ssh/id_rsa_clinical_trial} \
  ${AUTOSSH_REMOTE_USER}@${AUTOSSH_REMOTE_HOST}
```

如果你需要走脚本：

- `deploy/autossh_manual.sh`
- `deploy/autossh.env`（用于 systemd：`deploy/autossh.service`）

## C. Relay（中转机）检查

在 relay 上执行：

```bash
sudo bash /opt/trial-match/deploy/relay/diagnose_relay.sh
```

重点看：

- `ss -lntp` 是否出现 `:8300/:8501/:8502`（出现说明隧道已在 relay 上监听）
- `/var/log/nginx/findclinicaltrial.org.error.log` 是否仍是 `connect() failed (111: Connection refused)`

## D. 外部验证（绕过 Cloudflare 直连 origin）

在本机执行（把 `167.179.111.87` 替换成实际 origin IP）：

```bash
curl -I -k --resolve findclinicaltrial.org:443:167.179.111.87 https://findclinicaltrial.org/
curl -k --resolve findclinicaltrial.org:443:167.179.111.87 https://findclinicaltrial.org/api/health
```

## 常见故障点

- **Cloudflare 502 / Nginx 502**：90% 是隧道没建立成功，或 relay 上 8300/8501/8502 没监听
- **SSH 反向端口没监听**：检查 relay 的 `/etc/ssh/sshd_config`：
  - `AllowTcpForwarding yes`
  - `GatewayPorts no`（默认即可；Nginx 访问 127.0.0.1 不需要对外开放）
- **SSE 不流式**：relay 的 Nginx 需要 `proxy_buffering off`（已在模板里开启）
