# Treatbot 部署与上线就绪进展记录（供 clawbot 调用）

更新时间：2026-02-13

## 1. 当前代码状态

- 分支：`codex/p0-hardening`
- HEAD：`bde2bbb`（docs(env): set docker frontend port example to 3055）
- 近期关键提交（从新到旧）：
  - `bde2bbb` docs(env): set docker frontend port example to 3055
  - `7e17c43` ci: install workspace deps and use node 20
  - `269819b` chore(docker): shrink build context and ignore pm2 sockets
  - `84634d9` chore(health): minimize /api/health output in production and gate details
  - `16a6ef2` feat(prod): lock down uploads/metrics, harden logs, and fix SSE auth
  - `de8e00c` feat(e2e,ci): add Playwright traceId upload test and enforce qa gate

## 2. 主要上线就绪改进（已完成）

### 2.1 API 安全与数据隔离
- 系统性回归并修复 `MedicalRecord/Patient` 的读取/更新等关键接口，确保全部按 `userId` 约束，避免跨用户访问。
- 修复分步提取/作业相关接口的 ownership 校验缺失点，并加入回归测试覆盖。

### 2.2 可观测性（traceId）
- 后端：`X-Request-Id`/`traceId` 贯穿并在错误日志中落字段，便于线上定位。
- 前端：错误 toast / console 输出 `traceId`，便于用户反馈与后端日志关联。

### 2.3 UI 流程一致性
- 患者流程页 `upload/extract/results/structured` 统一空状态/加载骨架/错误态，减少跳转困惑与白屏等待。

### 2.4 E2E 与质量门禁
- 新增真实浏览器 E2E：登录 → 上传 → 触发失败 → 断言错误提示包含 `traceId`。
- 新增 `npm run qa:gate`（lint + build + backend tests），并在 CI 强制执行（未通过即阻止合并/发布）。

### 2.5 生产硬化（敏感面收敛）
- 禁止公开静态 `/uploads`（避免 PHI 通过直链被访问）。
- `/api/metrics`：生产环境默认不可用；需 `METRICS_TOKEN` 才可访问（`Authorization: Bearer <METRICS_TOKEN>`）。
- `/api/health`：生产环境默认返回最小信息 `{status,timestamp}`；需 `HEALTH_TOKEN` 才返回详细依赖/配置健康信息（`Authorization: Bearer <HEALTH_TOKEN>`）。
- access/error 日志避免记录 query string，并过滤 `authorization/cookie`，降低 token 泄漏风险。

## 3. GitHub Actions “run failed” 根因与修复（已完成）

### 3.1 根因
CI 仅执行了根目录 `npm ci`，但 `qa:gate` 会跑：
- `npm -C client run lint`（需要 `client/node_modules/.bin/next`）

因此在 GitHub runner 中出现报错：`sh: 1: next: not found`，导致 workflow 失败。

### 3.2 修复
- CI 改为 Node 20（与当前依赖链更匹配）。
- workflow 的 Install 步骤改为分别安装：
  - `npm ci`
  - `npm -C server ci`
  - `npm -C client ci`

结果：`codex/p0-hardening` 分支 CI 已恢复 green（qa-gate + e2e 均成功）。

相关文件：
- `/.github/workflows/ci.yml`
- `/infrastructure/docker/backend.Dockerfile`
- `/infrastructure/docker/frontend.Dockerfile`

## 4. 端口调整：使用 3055（已完成配置示例）

目标：公网通过 `http://<server-ip>:3055` 访问前端。

已更新：
- `/.env.docker`：增加 `FRONTEND_PORT=3055`
- `/.env.example`：增加 `FRONTEND_PORT` 说明（注释）

说明：`docker-compose.yml` 里 frontend 暴露端口是：
- `${FRONTEND_PORT:-3000}:3000`

## 5. 阿里云部署现状（root@8.148.145.28）

### 5.1 已执行的远端准备工作（已完成）
- 安装 `docker` + `docker-compose`，并启用 Docker 服务。
- 创建 `4G swap`（原机内存 1.6G，构建镜像易 OOM/卡死）。
- 将代码同步到 `/opt/treatbot/`，生成 `/opt/treatbot/.env`（包含随机 `JWT_SECRET/METRICS_TOKEN/HEALTH_TOKEN`）。
- 因该机无法直连 Docker Hub（443 超时），已配置 Docker registry mirror：
  - `/etc/docker/daemon.json` → `registry-mirrors: ["https://docker.m.daocloud.io"]`

### 5.2 当前阻塞
- 远端 SSH 异常：TCP 端口可连，但服务端不返回 SSH banner，表现为：
  - `kex_exchange_identification: Connection closed by remote host`
- 公网 HTTP（80）也不响应/超时。
- 3055 端口当前在公网侧可连（端口开放），但 `curl` 返回 `Empty reply from server`，说明该端口目前不是稳定的 HTTP 服务。

推断：机器处于资源耗尽/服务异常状态（可能与之前 build/IO 抖动有关），需要控制台介入恢复。

## 6. 下一步行动清单

### 6.1 需要人工（你）先做的事
- 在阿里云控制台使用 VNC/Workbench：
  1) 重启实例（Reboot）
  2) 进入系统后执行并确认：
     - `systemctl restart ssh`
     - `systemctl status ssh --no-pager`
  3) 安全组确认放行入站：TCP `3055`

### 6.2 clawbot/Codex 恢复后将执行的动作
- SSH 恢复后：
  - 更新远端代码到最新（建议继续用 rsync 同步到 `/opt/treatbot/`）。
  - 更新 `/opt/treatbot/.env`：
    - `FRONTEND_PORT=3055`
    - `CORS_ALLOWED_ORIGINS` 包含：`http://8.148.145.28:3055`
  - `cd /opt/treatbot && docker-compose down --remove-orphans || true`
  - `cd /opt/treatbot && docker-compose up -d --build`
- 验证：
  - `curl -fsS http://8.148.145.28:3055/api/health`
  - 浏览器访问：`http://8.148.145.28:3055`

## 7. 备注（安全与运维）

- `/api/metrics` 生产环境需要 `METRICS_TOKEN` 才可访问。
- `/api/health` 生产环境默认最小输出；如需详细健康信息，需要 `HEALTH_TOKEN`。
- EventSource/SSE 存在 query token 历史包袱，建议正式上线前切换为 Cookie 会话或 fetch streaming（可带 Authorization header），并确保反向代理不记录 query 参数。

