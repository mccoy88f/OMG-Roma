#!/bin/bash

echo "🔧 Inizializzazione configurazione OMG-Roma..."

# Default YouTube configuration
YOUTUBE_CONFIG='{
  "api_key": "",
  "search_mode": "hybrid",
  "followed_channels": [
    "https://www.youtube.com/@kurzgesagt",
    "https://www.youtube.com/@veritasium"
  ],
  "video_limit": 20,
  "quality_preference": "best", 
  "adult_content": false,
  "_metadata": {
    "description": "OMG-Roma YouTube Plugin Configuration",
    "author": "McCoy88f",
    "last_updated": "'$(date -Iseconds)'",
    "version": "1.0.0"
  }
}'

# Default plugins registry
PLUGINS_REGISTRY='{
  "plugins": {
    "youtube": {
      "enabled": true,
      "container": "youtube-plugin",
      "port": 3001
    }
  },
  "last_updated": "'$(date -Iseconds)'"
}'

# Get container IDs
GATEWAY_CONTAINER=$(docker ps --filter "name=gateway" --format "{{.ID}}" | head -n1)
YOUTUBE_CONTAINER=$(docker ps --filter "name=youtube-plugin" --format "{{.ID}}" | head -n1)

if [ -z "$GATEWAY_CONTAINER" ]; then
    echo "❌ Gateway container non trovato!"
    echo "Assicurati che lo stack sia avviato correttamente."
    exit 1
fi

if [ -z "$YOUTUBE_CONTAINER" ]; then
    echo "❌ YouTube plugin container non trovato!"
    echo "Assicurati che lo stack sia avviato correttamente."
    exit 1
fi

echo "📦 Gateway container: $GATEWAY_CONTAINER"
echo "📦 YouTube container: $YOUTUBE_CONTAINER"

# Initialize Gateway config
echo "⚙️  Inizializzazione config Gateway..."
echo "$PLUGINS_REGISTRY" | docker exec -i "$GATEWAY_CONTAINER" sh -c 'cat > /app/config/plugins.json'

# Initialize YouTube config  
echo "⚙️  Inizializzazione config YouTube..."
echo "$YOUTUBE_CONFIG" | docker exec -i "$YOUTUBE_CONTAINER" sh -c 'cat > /app/config.json'

# Restart containers to load config
echo "🔄 Riavvio container per caricare la configurazione..."
docker restart "$GATEWAY_CONTAINER" "$YOUTUBE_CONTAINER"

echo "✅ Configurazione inizializzata!"
echo ""
echo "🌐 Dashboard: http://localhost:3100"
echo "📱 Manifest Stremio: http://localhost:3100/manifest.json"
echo "🔍 Health check: http://localhost:3100/health"
echo ""
echo "💡 Prossimi passi:"
echo "1. Apri http://localhost:3100 per configurare i plugin"
echo "2. Aggiungi il manifest a Stremio"
echo "3. Configura la tua API key YouTube (opzionale)"
