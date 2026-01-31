# 本地与 Relay 中转服务器部署说明

本文档梳理了目前 `trial-match` 项目在「本地开发机」与「Relay 中转服务器」上的部署流程、依赖要求以及常见故障排查。文末附带当前环境验证情况，便于接手同事确认下一步操作。

---

## 1. 通用准备

### 1.1 代码与配置
- 仓库路径：`/Users/lijinming/trial-match`
- 关键配置文件：
  - `deploy/.env.production`（本地与服务器共用，可根据环境覆盖变量）
  - `ecosystem.config.js`（PM2 编排：Next.js 前端、Node 医疗 API、Python OCR）
  - `deploy/` 目录（包括启动脚本、autossh 配置、Relay 安装脚本等）

### 1.2 基础依赖
| 组件 | 建议版本 | 备注 |
| --- | --- | --- |
| Node.js | 20.x LTS | Node 22 与 PM2 5.x 存在 AsyncHook 崩溃风险，尽量避开 |
| npm | 随 Node 自带 | 若使用 `npm install`，请确保能访问 npm registry |
| Python | 3.10+ 推荐 | Python 3.11 及以上需确认兼容性（OCR 服务使用 Flask） |
| Redis | 6.x+ | 本地可通过 `brew services start redis` |
| MongoDB | 6.x+ | 需预先安装并启动 `mongod` |
| pm2 | 5.3+ | 若遇到 `RangeError: Map maximum size exceeded`，请换 Node 20 |
| autossh | Relay 节点需要 | 提供端口反向隧道 |
| nginx / certbot | Relay 节点需要 | 反代 + HTTPS |

---

## 2. 本地环境部署

### 2.1 环境变量
```bash
# 基本后端 / 前端设置
cp deploy/.env.production .env.local        # Next.js 默认读取 .env.local
cp deploy/.env.production server/.env       # Node API 读取
```
针对 OCR，如无阿里云凭证，可保持 `ALIBABA_ACCESS_KEY_*` 为空；Node API 会在无法调用 Python 服务时自动切换至 Tesseract 回退。

### 2.2 依赖安装
```bash
# 安装 Node 模块
npm install
cd server && npm install && cd ..
cd client && npm install && cd ..

# Python 依赖（可选）
python3 -m venv python_ocr_service/.venv
source python_ocr_service/.venv/bin/activate
pip install -r python_ocr_service/requirements.txt
deactivate
```
> 提示：在无外网环境下，`pip` 安装会失败，可先离线下载 wheel 或使用已有系统包。脚本中提供 `SKIP_PYTHON_OCR=1` 以跳过。

### 2.3 启动服务
推荐使用部署脚本，支持变量控制：
```bash
cd /Users/lijinming/trial-match
SKIP_PM2=1 ./deploy/start_local_services.sh
```
- `SKIP_PM2=1`：如果 pm2 与当前 Node 版本不兼容（Node 22），可跳过并手动启动：
  ```bash
  npm run dev:all              # 同时拉起 OCR/Node API/Next.js
  # 或分别运行
  npm run ocr
  npm run server
  npm run client
  ```
- `SKIP_PYTHON_OCR=1`：在离线环境不想运行 pip 时启用。

### 2.4 验证步骤
1. **服务状态**
   ```bash
   pm2 status                                     # 若启用 PM2
   redis-cli ping                                 # 期望 PONG
   mongosh --eval "db.runCommand({ ping: 1 })"    # 期望 ok
   curl -s http://localhost:5001/health           # Python OCR
   curl -s http://localhost:5002/api/health       # Node API
   ```
2. **OCR 上传测试**
   ```bash
  curl -s -o - \
     -X POST http://localhost:5002/api/medical/upload \
     -H "Authorization: Bearer <token>" \
     -F "file=/Users/lijinming/Downloads/report.pdf"
   ```
3. **前端访问**
   - 打开 `http://localhost:3000`
   - 登录/上传/查看提取结果

---

## 3. Relay 中转服务器部署

Relay 服务器用于承载 autossh 隧道、nginx 反向代理与 SSL 证书。

### 3.1 服务器准备
| 组件 | 说明 |
| --- | --- |
| 操作系统 | Ubuntu 20.04+ / Debian 12+（具备 systemd） |
| 组件 | `nginx`, `certbot`, `autossh`, `pm2` (可选) |
| 防火墙 | 确保 80/443 打开对外访问 |

### 3.2 初始配置
1. **同步仓库脚本**
   ```bash
   scp -r deploy/relay <relay-user>@<relay-host>:~/trial-match/deploy/relay
   ```
2. **执行 Relay 初始化**
   ```bash
   cd ~/trial-match/deploy/relay
   sudo ./setup_relay.sh
   ```
   - 脚本会安装 nginx、certbot、部署反代配置
   - 需要提前在 `deploy/relay/nginx/site.conf` 中调好域名指向
3. **证书自动化**
   - `setup_relay.sh` 会调用 `certbot` 申请证书
   - 如需调试，可运行 `sudo certbot renew --dry-run`

### 3.3 autossh 隧道
1. **本地机配置**
   - `deploy/autossh.env` 包含默认端口映射：前端 8300、OCR 8501、API 8502、匹配 8503
   - `deploy/autossh.service` 供 systemd 使用，或通过 launchctl (macOS) 运行
2. **启动**
   ```bash
   # macOS LaunchCtl 例子
   launchctl load ~/Library/LaunchAgents/com.trialmatch.autossh.plist

   # Linux systemd 例子
   sudo cp deploy/autossh.service /etc/systemd/system/
   sudo systemctl enable --now autossh
   ```
3. **Relay 侧 nginx 配置**
   - `deploy/relay/nginx/clinical-match.conf` 示例：将 `frontend.example.com` 反向代理至本地 8300
   - 记得重启 nginx：`sudo systemctl reload nginx`

### 3.4 Relay 上的本地构建
若需在 Relay 直接运行服务（而不仅仅是反代），可以按照「本地部署」步骤操作。请注意：
- `deploy/.env.production` 中的域名/IP 需改为公网可访问地址
- 结合 PM2 或 systemd 常驻运行
- 调整 `NEXT_PUBLIC_API_BASE_URL` 指向 Relay 公网地址

---

## 4. 当前测试状态与待完成事项

| 项目 | 状态 | 备注 |
| --- | --- | --- |
| Next.js `next build` | ✅ | 在离线沙箱内成功编译；lint 已跳过（`ignoreDuringBuilds`） |
| `deploy/start_local_services.sh` | ⚠️ | 构建通过，但在 Node 22 + PM2 5.x 组合下触发 `RangeError`；脚本已新增提示与跳过开关 |
| Python OCR 服务 | ⚠️ | 无阿里云凭证时可启动；但沙箱禁止监听本地端口导致进程以 `Operation not permitted` 退出（实际环境中可正常运行） |
| Redis/Mongo 验证 | ⏳ | 沙箱限制导致未能执行 ping；需在真实环境确认 |
| autossh / Relay 脚本 | 📝 | 已提供配置与脚本，未在沙箱内执行（需实际服务器测试） |

---

## 5. 常见问题排查

1. **PM2 启动崩溃**
   - 日志：`.pm2/pm2.log` 出现 `RangeError: Map maximum size exceeded`
   - 解决：使用 Node 20 LTS；或升级/downgrade PM2
2. **pip 无法安装**
   - 日志出现 `Could not find a version that satisfies…`
   - 解决：确认网络出口、使用阿里云/清华镜像、或先手动下载 wheel
3. **OCR 报凭证错误**
   - 日志 `ValueError: the access key id is empty`
   - 解决：在 `.env.production` 中配置 `ALIBABA_ACCESS_KEY_ID/SECRET`；或允许回退到 Tesseract
4. **Relay 证书申请失败**
   - 常见原因：DNS 未指向 Relay 公网 IP；80 端口被占用
   - 解决：提前确认域名解析；关闭冲突服务

---

如果需要进一步的上下游联调、日志位置或健康检查脚本位置，可查阅：
- `deploy/README.md`：详细部署手册
- `logs/`：本地运行日志（`backend-local.log`, `ocr-service-local.log` 等）
- `deploy/healthcheck.sh`：健康检查脚本（curl + redis/mongo）

祝部署顺利，如有问题可以在文档中补充。***
