# 🐳 Docker Quick Start Guide

## Prerequisites
- Docker and Docker Compose installed on your system
- 8GB+ RAM recommended

## 🚀 Quick Start

### 1. Clone and Setup
```bash
git clone <your-repo>
cd trial-match

# Copy environment template
cp .env.example .env

# Edit with your API keys
nano .env
```

### 2. Run with Docker
```bash
# Production mode (recommended for testing)
docker-compose up --build

# Or run in background
docker-compose up -d --build

# Development mode (with hot reload)
docker-compose -f docker-compose.dev.yml up --build
```

### 3. Access the Application
- **Web App**: http://localhost:3000
- **API**: http://localhost:5001
- **OCR Service**: http://localhost:5002
- **MongoDB**: localhost:27017

## 🔧 Required Environment Variables

Edit `.env` with your actual values:

```bash
# JWT Secret - use a strong random string
JWT_SECRET=your-super-secret-jwt-key-here

# Moonshot API Key for LLM features
OPENAI_API_KEY=your_moonshot_api_key_here

# Alibaba Cloud OCR credentials
ALIBABA_ACCESS_KEY_ID=your_alibaba_access_key_id_here
ALIBABA_ACCESS_KEY_SECRET=your_alibaba_access_key_secret_here
```

## 📋 Useful Commands

```bash
# View logs
docker-compose logs -f

# Stop services
docker-compose down

# Rebuild everything
docker-compose down && docker-compose up --build

# Access database
docker-compose exec mongodb mongosh -u admin -p password123
```

## 🛠️ Architecture

The setup includes 4 services:
- **Frontend**: Next.js React app (port 3000)
- **Backend**: Node.js API server (port 5001)
- **OCR Service**: Python Flask app (port 5002)
- **MongoDB**: Database (port 27017)

All services are automatically networked and configured to work together.

## 💡 Tips

- The database is automatically seeded with sample clinical trials
- Default MongoDB credentials: admin/password123
- Volumes persist data between container restarts
- All dependencies are automatically installed

That's it! Your clinical trial matching platform should be running on http://localhost:3000