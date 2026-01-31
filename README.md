# Clinical Trial Matching Platform Demo

A Next.js + Node.js + MongoDB-based clinical trial matching demonstration platform that helps patients quickly find matching clinical trials.

## 产品文档（中文）

更完整的产品级说明（PRD/用户指南/运维/API/隐私安全/验收）见：`docs/product/zh-CN/README.md`。

## 🎉 Latest Updates

### v2.2 (2025-10-03) - Code Quality & Cleanup ✅
- Removed 10+ unused variables and 7 unused imports
- Improved code readability and maintainability
- Zero critical warnings in production build

### v2.1 (2025-10-03) - Performance Optimization ⚡
- Added React.memo to UI components (Button, Card, Input)
- Implemented dynamic imports for ThinkingMode and ClinicalArchiveView
- Reduced bundle size by 3-4% across patient workflow pages
- Next.js compiler optimizations (console removal, tree-shaking)

### v2.0 (2025-10-03) - TypeScript Fixes & Build Success 🔧
- Fixed all TypeScript type errors (0 `any` types remaining)
- Production build now compiles successfully
- Improved type safety across 10+ components

**See [CHANGELOG.md](./CHANGELOG.md) for detailed release notes**
**See [ROADMAP.md](./ROADMAP.md) for future plans**

---

## Features

### Frontend Features
- **Patient Login/Registration**: User authentication system
- **Medical Record Upload Interface**: Supports PDF, image, and text file uploads with automatic OCR extraction
- **Personal Medical Record Cards**: Structured display of diagnosis, staging, genetic testing, and other information
- **Clinical Trial Recommendations**: Intelligent matching of relevant trials with match scores and detailed information

### Backend API
- **File Upload & OCR**: `/api/medical/upload` - Supports file upload and text extraction
- **Text Parsing**: `/api/medical/parse` - NLP parsing of medical text into structured data
- **Trial Matching**: `/api/medical/match` - Matches clinical trials based on medical records
- **User Authentication**: `/api/auth/login`, `/api/auth/register`

### Database
- **User Management**: Stores user account information
- **Medical Record Storage**: Saves structured medical record data
- **Trial Database**: Mock clinical trial data (includes 5 sample trials)

## Tech Stack

- **Frontend**: Next.js (App Router) + React + TypeScript + TailwindCSS
- **Backend**: Node.js + Express + MongoDB + Mongoose
- **File Processing**: Multer (file upload)
- **Authentication**: JWT + bcryptjs
- **Styling**: TailwindCSS + Tailwind Forms

## Repository Structure

- `client/` – Next.js frontend application
- `server/` – Express API, services, and database layer
- `python_ocr_service/` – Flask-based OCR microservice
- `data/clinical_trials/` – Seed CSV datasets for trial matching
- `docs/` – Project documentation (operations notes, prompts, OCR guides)
- `samples/` – Reference media and medical record examples grouped by type
- `scripts/` – Operational helper scripts (e.g., Docker bootstrap)
- `infrastructure/docker/` – Dockerfiles for backend, frontend, and OCR services

## Quick Start

### Prerequisites
- Node.js (v16+)
- MongoDB (local or cloud)
- Redis (for production queue/caching; optional in mock mode)
- npm or yarn

### Installation Steps

1. **Clone the project**
```bash
git clone <repository-url>
cd trial-match
```

2. **Install all dependencies**
```bash
npm run install-all
```

3. **Configure environment variables**
```bash
# Configure in server/.env (example):
PORT=5001
MONGODB_URI=mongodb://localhost:27017/clinicalmatch
JWT_SECRET=your-jwt-secret-key-here
JWT_EXPIRES_IN=7d

# Moonshot (Kimi) LLM configuration
OPENAI_API_KEY=your-moonshot-api-key
baseURL=https://api.moonshot.cn/v1

# LLM privacy mode for OCR medical text:
# full | redact | disallow
LLM_PHI_MODE=full

# Agreement version (recorded at registration)
COMPLIANCE_SECURITY_AGREEMENT_VERSION=2025-12-18

# Match history retention
MATCH_HISTORY_MAX=50

# Output caps (reduce payload + cost)
LLM_MATCH_MAX_RESULTS=15
MATCH_MAX_RESULTS=50

# Optional: Alibaba Cloud OCR proxy to Python microservice
ALIBABA_ACCESS_KEY_ID=your-ak
ALIBABA_ACCESS_KEY_SECRET=your-sk
ALIBABA_OCR_ENDPOINT=ocr-api.cn-hangzhou.aliyuncs.com
ALIBABA_OCR_REGION=cn-hangzhou
PYTHON_OCR_URL=http://localhost:5002

# Recommended (no-mock) runtime behavior
STRICT_MODE=true
REQUIRE_LLM=true
ALLOW_PARSING_FALLBACK=false
ALLOW_OCR_TESSERACT_FALLBACK=false
ALLOW_OCR_MOCK=false

# CORS configuration
CORS_ALLOWED_ORIGINS=http://localhost:3000
CORS_ALLOWED_METHODS=GET,HEAD,PUT,PATCH,POST,DELETE
CORS_ALLOW_CREDENTIALS=true

# Rate limiting (per IP)
RATE_LIMIT_POINTS=120
RATE_LIMIT_DURATION=60
RATE_LIMIT_BLOCK_DURATION=0

# Trial data CSV mapping
TRIAL_CSV_PATH=./data/clinical_trials/liver_cancer_trials.csv

# Trial cache refresh (helps keep recruiting status up-to-date when you update the trials JSON/CSV)
TRIALS_INMEMORY_TTL_MS=300000
ALLOW_TRIAL_REFRESH=false
```

4. **Initialize database**
```bash
cd server
npm run setup
```

5. **Start the application**
```bash
# Start both frontend and backend from root directory
npm run dev

# Or start separately:
# Backend: cd server && npm run dev
# Frontend: cd client && npm run dev

# Launch queue workers (required when Redis is enabled)
cd server
npm run worker

# Optional: start the Python OCR microservice
npm run ocr

# Start frontend/backend/Python OCR microservice simultaneously (recommended)
npm run dev:all
```

## 一键运行（docker-compose，推荐）

```bash
cp .env.example .env
./deploy/one_click_docker_compose.sh --smoke
```

## Mac mini 单机部署（推荐用于内测/小规模试运行）

核心思路：用 `HOST_DATA_DIR` 把 MongoDB/Redis/uploads 持久化到一块数据盘，方便备份与迁移。

```bash
cp ./deploy/macmini.env.example .env
# 编辑 .env：至少设置 HOST_DATA_DIR 与 JWT_SECRET
./deploy/macmini_one_click.sh
```

（可选）备份：

```bash
./deploy/macmini_backup.sh
```

（可选）3 年留存清理（先 dry-run 再执行）：

```bash
cd server
npm run retention:dry
RETENTION_MAX_DELETE=500 npm run retention:run
```

需要通过 relay 域名对外提供访问（8300/8501/8502）：

```bash
cp ./deploy/autossh.docker-compose.env.example ./deploy/autossh.env
# 编辑 ./deploy/autossh.env：REMOTE 用户/主机、SSH key 路径、LOCAL_* 端口（通常 frontend=3002, api=5002, ocr=5003）
./deploy/one_click_docker_compose.sh --relay --tunnel --autossh-env ./deploy/autossh.env
```

### Access the Application
- Frontend: http://localhost:3000
- Backend (direct): http://localhost:5001
- Backend (via frontend proxy): http://localhost:3000/api/health
- OCR Service (local dev): http://localhost:5002

### API Responses & Error Handling
- Backend endpoints return a normalized JSON envelope `{ success, message, data, meta?, traceId }`.
- Errors include HTTP-appropriate status codes, a `code` field when available, and share the `traceId` for log correlation.
- Rate limiting and authentication failures now surface consistent error bodies so the frontend can display actionable feedback.

## Project Structure

```
trial-match/
├── client/                 # Next.js Frontend
│   ├── src/
│   │   ├── components/     # Reusable components
│   │   ├── app/            # App Router pages + API proxy route
│   │   └── ...
│   └── package.json
├── server/                 # Node.js Backend
│   ├── middleware/         # Middleware
│   ├── models/            # MongoDB models
│   ├── routes/            # API routes
│   ├── seedData.js        # Mock data
│   ├── setup.js           # Database initialization
│   └── package.json
├── python_ocr_service/     # Python OCR Microservice
│   ├── ocr_server.py      # Flask OCR server
│   └── requirements.txt   # Python dependencies
└── package.json           # Root configuration
```

## Data Notes

- Trial data is loaded from CSV/JSON under `data/` and can be seeded into MongoDB via `cd server && npm run setup`.
- Matching supports both classic and enhanced flows; streaming batch matching is available under `/api/medical/match/:recordId/*`.

## Usage Flow

1. **Register/Login**: Create an account or login with existing credentials
2. **Upload Medical Records**: Select PDF, image, or text files to upload
3. **Text Extraction**: System automatically extracts text, user can edit and confirm
4. **Generate Medical Record Card**: Parse into structured data and display medical record summary
5. **AI Integration View**: Click "AI View" on medical record details page to see richer medical record cards generated by LLM (including corrected text, structured information, and timeline)
6. **Match Trials**: Click match button to view recommended clinical trials
7. **View Details**: Click on trials to get detailed information and contact details

## API Documentation

### Authentication API
- `POST /api/auth/register` - User registration
- `POST /api/auth/login` - User login
- `GET /api/auth/me` - Get current user
- `PATCH /api/auth/profile` - Update profile
- `POST /api/auth/change-password` - Change password

### Medical Data API
- `POST /api/medical/upload` - File upload + OCR
- `POST /api/medical/parse` - Text parsing into structured data
- `POST /api/medical/match` - Match clinical trials
- `POST /api/medical/match/:recordId/start` - Start streaming/batch match job
- `GET /api/medical/match/:recordId/stream` - SSE stream updates
- `GET /api/medical/match/:recordId/status` - Get batch match status/results
- `GET /api/medical/records` - Get user medical record list

## Development Notes

1. **Security**: This project is for demonstration purposes, production environments require enhanced security measures
2. **Data Privacy**: Medical data needs to comply with privacy regulations like HIPAA
3. **Performance Optimization**: Large file processing requires consideration of performance and storage
4. **Error Handling**: Add more comprehensive error handling and logging
5. **Environment Variable Naming**: LLM uses `OPENAI_API_KEY` and `baseURL`, ensure consistency with `server/services/llmIntegrationService.js`. The `MOONSHOT_*` variables in root directory `.env` are not read by the server.

## Frontend LLM Integration Notes

- Upload page provides "Intelligent Medical Record Integration" toggle, when enabled, backend calls LLM integration during parsing (`POST /api/medical/parse` with `useLLM=true`).
- Medical record details page supports two views:
  - Standard view: `/record/:recordId`
  - AI view: `/record/ai/:recordId`, renders LLM's `fullStructuredData` (based on `medical_record.html` design).
  - Navigation bar automatically displays "AI View/Standard View" toggle links on record pages.

## License

MIT License

## Contact Information

For questions or suggestions, please create a GitHub Issue.
