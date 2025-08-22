#!/bin/bash

echo "🚀 OMG-Roma Setup"
echo "================="

# Check requirements
echo "🔍 Checking requirements..."

if ! command -v docker &> /dev/null; then
    echo "❌ Docker not found. Please install Docker first."
    exit 1
fi

if ! command -v docker-compose &> /dev/null; then
    echo "❌ Docker Compose not found. Please install Docker Compose first."
    exit 1
fi

echo "✅ Docker and Docker Compose found"

# Create directory structure
echo "📁 Creating directory structure..."

mkdir -p config
mkdir -p plugins/youtube/src
mkdir -p gateway/src
mkdir -p gateway/public

echo "✅ Directory structure created"

# Copy configuration files
echo "⚙️  Setting up configurations..."

# Create default plugin registry
cat > config/plugins.json << 'EOF'
{
  "plugins": {
    "youtube": {
      "enabled": true,
      "container": "youtube-plugin",
      "port": 3001
    }
  },
  "last_updated": "2024-01-01T00:00:00.000Z"
}
EOF

echo "✅ Configuration files created"

# Build and start containers
echo "🐳 Building and starting containers..."

docker-compose up --build -d

echo "⏳ Waiting for services to be ready..."
sleep 10

# Check if services are running
echo "🔍 Checking service health..."

# Check gateway
if curl -f http://localhost:3100/health &> /dev/null; then
    echo "✅ Gateway is healthy"
else
    echo "❌ Gateway health check failed"
fi

# Check YouTube plugin
if curl -f http://localhost:3001/health &> /dev/null; then
    echo "✅ YouTube plugin is healthy"
else
    echo "❌ YouTube plugin health check failed"
fi

echo ""
echo "🎉 Setup completed!"
echo ""
echo "📱 Stremio manifest: http://localhost:3100/manifest.json"
echo "⚙️  Web interface: http://localhost:3100"
echo "📊 Health check: http://localhost:3100/health"
echo "🔗 Repository: https://github.com/mccoy88f/OMG-Roma"
echo ""
echo "📝 Next steps:"
echo "1. Open http://localhost:3100 to configure plugins"
echo "2. Add the manifest URL to Stremio"
echo "3. Enjoy OMG-Roma modular streaming!"
echo ""
echo "🔧 Useful commands:"
echo "  docker-compose logs -f          # View all logs"
echo "  docker-compose logs -f youtube-plugin  # View YouTube plugin logs"
echo "  docker-compose down             # Stop all services"
echo "  docker-compose up --build       # Rebuild and restart"