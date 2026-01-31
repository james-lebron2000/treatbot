# Docker Compose 部署（推荐先跑通可用性）

该方式将 **MongoDB + Redis + Node 后端 + Next 前端 + Python OCR** 全部运行在同一台机器上，适合快速上线与单机生产部署。

## 1) 准备配置

1. 从模板复制一份环境变量：

```bash
cp .env.example .env
```

2. 至少修改以下变量（生产必改）：

- `JWT_SECRET`：随机强密钥
- `OPENAI_API_KEY`：如需 LLM（可留空）

可选（推荐保留默认即可）：

- `LLM_PHI_MODE=full`：允许调用第三方模型，但会对可识别信息做脱敏后再发送；`disallow` 会阻止任何需要发送病历文本/患者结构化信息的 LLM 调用
- `COMPLIANCE_SECURITY_AGREEMENT_VERSION`：注册时强制勾选的协议版本号
- `MATCH_HISTORY_MAX`：每个病历保留的匹配记录上限（默认 50）

OCR（可选）：

- `ALIBABA_ACCESS_KEY_ID/ALIBABA_ACCESS_KEY_SECRET`：不配置也能启动，但会进入 OCR fallback（上传图片 OCR 会失败）

## 2) 启动

### 一键启动（推荐）

本仓库提供一键脚本：自动 `docker compose up -d --build`、等待健康检查，通过同源 `/api` 代理验证后端。

```bash
./deploy/one_click_docker_compose.sh
```

首次部署建议加上冒烟验证：

```bash
./deploy/one_click_docker_compose.sh --smoke
```

如需要对接既有的 relay 中转（8300/8501/8502）并自动拉起隧道：

```bash
./deploy/one_click_docker_compose.sh --relay --tunnel --autossh-env ./deploy/autossh.env
```

（首次配置 relay 机器可加 `--setup-relay`，之后不需要每次都跑）

```bash
docker compose up -d --build
docker compose ps
```

如需要对接既有的“中转隧道/relay Nginx（8300/8501/8502）”，请使用额外的 compose 覆盖文件，把 OCR/API 暴露到宿主机端口（便于 autossh 反向隧道）：

```bash
docker compose -f docker-compose.yml -f docker-compose.relay.yml up -d --build
```

访问：

- 前端：`http://localhost:3000`（如端口冲突，可设 `FRONTEND_PORT=3001`）
- 后端（通过前端反向代理）：`http://localhost:3000/api/health`（或 `http://localhost:${FRONTEND_PORT}/api/health`）

说明：

- 浏览器只需要访问同源的 `/api/*`，由 Next 在服务端转发到 `backend`（支持 SSE 流式返回与上传）
- 后端容器内访问 OCR：`http://ocr-service:5002`

## 3) 验证全流程（用测试数据）

建议在宿主机执行（通过 `http://localhost:3000/api` 走同源代理，覆盖 SSE 流式匹配链路）：

```bash
./scripts/smoke_docker_compose.sh
```

如本机 `3000` 被占用，冒烟脚本会自动选择 `3001-3005` 的空闲端口；也可以手动指定：

```bash
FRONTEND_PORT=3001 ./scripts/smoke_docker_compose.sh
```

## 4) 停止与清理

```bash
docker compose down
```

清理数据（会删除 Mongo/Redis 持久化卷，谨慎）：

```bash
docker compose down -v
```

## 5) 生产化建议（最低配）

- 使用域名 + HTTPS（Nginx/Caddy）反代到 `frontend:3000`
- 将 `.env` 以密钥管理方式保存（不要提交到 Git）
- 定期备份 `mongodb_data` 卷（以及 `./uploads`）
