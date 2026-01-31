# Cleanup Candidates

以下文件/目录看起来属于运行时生成或历史遗留的产物，可考虑在提交代码前清理或移出仓库。请在删除前确认团队确实不再需要它们。

## 运行时日志与缓存
- `logs/` 目录下的大量日志（例如 `application*.log`, `backend-local.log`, `frontend.log`, `ocr-service-local.log`, `tunnel*.log` 等）——建议保留必要的最新日志，其余可清空或添加到 `.gitignore`。
- `pids/` 目录（PM2/进程管理生成）——属于运行时文件。
- `uploads/` 目录中的测试上传文件（若仅用于临时调试）。
- `~/.pm2/` 或仓库根目录下的 `.pm2/`（由 PM2 生成），不应纳入版本管理。

## 配置/环境文件
- 根目录 `.env`：当前包含真实凭证，应移出仓库或改为示例文件，并在 `.gitignore` 中忽略。
- `deploy/.env.production`：请确认生产环境不直接使用硬编码的默认值；如需公开模板，可另存为 `.env.production.example`。

## 可能的遗留文档
- `docs/PHASE1_*`, `docs/PHASE2_*`, `docs/REFACTORING_*` 等阶段性总结，如已迁移到其他知识库，可移除或归档。
- `NGINX.md`, `production-deployment-guide.md` 等是否与 `docs/` 中的新文档重复，请根据最新版本保留一份权威来源。

## 其他
- `cloudflare-worker.js`, `docker-setup.sh`, `ssh-tunnel-manual.sh` 等工具脚本，如已被新的部署方案替代，可集中整理到 `archive/` 或移除。
- `test-data.json`, `test_register*.json`, `structured_patient.json` 等示例数据，如仅用于早期演示，可改放 `samples/` 并说明用途。

## 根目录新增观察
- `.DS_Store`、`.claude/`, `.pm2/`：本地工具或运行时产生，建议删除后加入 `.gitignore`。
- `NGINX.md`, `findclinicaltrial.org`, `nginx-*.conf`, `load-balancer.conf`, `monitoring-setup.conf`, `security-hardening.conf`：内容已由 `deploy/relay/nginx-findclinicaltrial.org.conf` 等新脚本覆盖，可视情况合并到 `deploy/` 或迁移至 `archive/`。
- `DEPLOYMENT.md`, `PRODUCTION_DEPLOYMENT_GUIDE.md`, `production-deployment-guide.md`, `PRODUCTION_DEPLOYMENT_GUIDE.md`（位于 `docs/` 和根目录的多个版本）：文档内容高度重叠，建议统一到 `docs/local-and-relay-deploy.md` 或保留唯一权威版本。
- `cloudflare-worker.js`：若已经改为 Nginx/relay 反向代理，可归档或删除。
- `notes/llm_raw_output.txt`, `reports/*.xlsx|.png|.docx` 等手工分析产物，如不再需要可移出仓库或存放在 `archive/`。
- `data/YHBI2.jpg`, `uploads/`、`logs/`、`pids/`：测试或运行时文件，建议清理并在 `.gitignore` 中保持忽略。

> 建议：在清理过程中同步更新 `.gitignore`，避免运行时文件再次被跟踪；对于仍需保留但不常用的资料，可迁移至 `archive/` 目录。***
