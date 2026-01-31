#!/bin/bash
# setup-trial-match.sh - One-command setup script

set -e

echo "🚀 Setting up Clinical Trial Matching Platform..."

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    echo "❌ Docker not found. Please install Docker first."
    echo "Visit: https://docs.docker.com/get-docker/"
    exit 1
fi

# Check if docker-compose is available
if ! command -v docker-compose &> /dev/null && ! docker compose version &> /dev/null; then
    echo "❌ docker-compose not found. Please install docker-compose."
    exit 1
fi

# Clone repository if not already present
if [ ! -f "docker-compose.yml" ]; then
    echo "📥 Cloning repository..."
    read -p "Enter repository URL: " REPO_URL
    git clone "$REPO_URL" trial-match
    cd trial-match
fi

# Setup environment
if [ ! -f ".env" ]; then
    echo "⚙️ Setting up environment..."
    cp .env.example .env
    echo "📝 Please edit .env file with your API keys:"
    echo "   - JWT_SECRET (generate a random string)"
    echo "   - OPENAI_API_KEY (Moonshot API key)"
    echo "   - ALIBABA_ACCESS_KEY_ID & SECRET (Alibaba Cloud OCR)"
    echo ""
    read -p "Press Enter after editing .env file..."
fi

# Build and start services
echo "🏗️ Building and starting services..."
docker-compose up --build -d

# Wait for services to start
echo "⏳ Waiting for services to start..."
sleep 30

# Check if services are running
echo "🔍 Checking service status..."
docker-compose ps

echo ""
echo "✅ Setup complete!"
echo ""
echo "🌐 Access the application:"
echo "   Web App: http://localhost:3000"
echo "   API:     http://localhost:5001"
echo "   OCR:     http://localhost:5002"
echo ""
echo "📊 View logs: docker-compose logs -f"
echo "🛑 Stop services: docker-compose down"
echo ""