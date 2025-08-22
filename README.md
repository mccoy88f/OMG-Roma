# OMG-Roma

Un addon modulare per Stremio con architettura plugin per supportare multiple piattaforme video.

**Repository:** https://github.com/mccoy88f/OMG-Roma  
**Autore:** McCoy88f

## 🏗️ Architettura

```
┌─────────────────────┐    ┌─────────────────────┐
│   Stremio Client    │────│   API Gateway       │
│                     │    │   (Port 3100)       │
└─────────────────────┘    └─────────┬───────────┘
                                     │
                     ┌───────────────┼───────────────┐
                     │               │               │
              ┌──────▼──────┐ ┌──────▼──────┐ ┌──────▼──────┐
              │   YouTube   │ │   Vimeo     │ │   Twitch    │
              │   Plugin    │ │   Plugin    │ │   Plugin    │
              │ (Port 3001) │ │ (Port 3002) │ │ (Port 3003) │
              └─────────────┘ └─────────────┘ └─────────────┘
```

## 🚀 Avvio Rapido

### Prerequisiti
- Docker & Docker Compose
- Git

### Installazione

```bash
# Clone del repository
git clone https://github.com/mccoy88f/OMG-Roma.git
cd OMG-Roma

# Avvio con Docker Compose
docker-compose up --build
```

### Configurazione

1. **Apri l'interfaccia web**: `http://localhost:3100`
2. **Configura i plugin** tramite l'interfaccia web
3. **Aggiungi in Stremio**: 
   - Vai su Stremio → Addons → Community Addons
   - Incolla: `http://localhost:3100/manifest.json`

## 📦 Plugin Disponibili

### YouTube Plugin

**Cataloghi Stremio:**
- **"Ricerca YouTube"**: Ricerca globale video YouTube
- **"YouTube Discover"**: Video dai canali seguiti

**Configurazione:**
```json
{
  "api_key": "YOUR_YOUTUBE_API_KEY",
  "search_mode": "hybrid",
  "followed_channels": [
    "https://www.youtube.com/@kurzgesagt"
  ],
  "adult_content": false
}
```

**Modalità di ricerca:**
- `api`: YouTube Data API (veloce, quota limitata)
- `ytdlp`: yt-dlp search (gratuito, più lento)
- `hybrid`: API con fallback a yt-dlp

## 🔧 Struttura Progetto

```
omg-roma/
├── docker-compose.yml          # Orchestrazione servizi
├── gateway/                    # Gateway principale
│   ├── Dockerfile
│   ├── package.json
│   └── src/
│       ├── index.js           # Server principale
│       ├── plugin-manager.js  # Gestione plugin
│       ├── stremio-adapter.js # Adattatore Stremio
│       └── web-ui.js          # Interfaccia web
├── plugins/                   # Directory plugin
│   └── youtube/              # Plugin YouTube
│       ├── Dockerfile
│       ├── package.json
│       ├── plugin.json       # Configurazione plugin
│       └── src/
│           ├── index.js      # Server plugin
│           ├── ytdlp-service.js
│           └── config-manager.js
└── config/                   # Configurazioni
    ├── plugins.json          # Registry plugin
    └── youtube.config.json   # Config YouTube
```

## 🔌 API Plugin Standard

Ogni plugin deve implementare questi endpoint:

### `/health` (GET)
```json
{
  "status": "healthy",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "plugin": "youtube",
  "version": "1.0.0"
}
```

### `/search` (POST)
```json
{
  "search": "query string",
  "skip": 0,
  "limit": 20
}
```

**Risposta:**
```json
{
  "videos": [
    {
      "id": "video_id",
      "title": "Video Title",
      "description": "Description...",
      "thumbnail": "https://...",
      "duration": "10:30",
      "channel": "Channel Name",
      "publishedAt": "2024-01-01T00:00:00.000Z",
      "adult": false
    }
  ],
  "hasMore": true
}
```

### `/discover` (POST)
Simile a `/search` ma per contenuti curati/seguiti.

### `/meta` (POST)
```json
{
  "videoId": "abc123"
}
```

### `/stream` (POST)
```json
{
  "videoId": "abc123"
}
```

**Risposta:**
```json
{
  "streams": [
    {
      "name": "🎥 YouTube - Best Quality",
      "url": "https://...",
      "quality": "1080p",
      "format": "MP4"
    }
  ]
}
```

## 🛠️ Creazione Nuovo Plugin

### 1. Struttura Base

```bash
mkdir plugins/myplugin
cd plugins/myplugin
```

### 2. plugin.json
```json
{
  "id": "myplugin",
  "name": "My Plugin",
  "version": "1.0.0",
  "language": "javascript",
  "port": 3004,
  "endpoints": {
    "search": "/search",
    "discover": "/discover", 
    "meta": "/meta",
    "stream": "/stream"
  },
  "stremio": {
    "search_catalog_name": "Ricerca MyPlugin",
    "search_catalog_id": "myplugin_search",
    "discover_catalog_name": "MyPlugin Discover",
    "discover_catalog_id": "myplugin_discover"
  }
}
```

### 3. Dockerfile
```dockerfile
FROM node:18-alpine
# ... implementa il tuo ambiente
```

### 4. Implementa API Standard
Implementa tutti gli endpoint richiesti.

### 5. Aggiungi a docker-compose.yml
```yaml
myplugin-plugin:
  build: ./plugins/myplugin
  environment:
    - PORT=3004
  volumes:
    - ./config/myplugin.config.json:/app/config.json
```

## 🔒 Gestione Contenuti Adulti

I plugin possono gestire contenuti per adulti:

1. **Configurazione Plugin**: Flag `adult_content` 
2. **Metadata Video**: Flag `adult` per ogni video
3. **Filtri Automatici**: Il gateway filtra se necessario
4. **Manifest Stremio**: Viene impostato `behaviorHints.adult`

## 📊 Monitoring & Health Check

### Gateway Health Check
```bash
curl http://localhost:3100/health
```

### Plugin Status
L'interfaccia web mostra lo stato di tutti i plugin in tempo reale.

### Logs
```bash
# Logs di tutti i servizi
docker-compose logs -f

# Logs specifico plugin
docker-compose logs -f youtube-plugin
```

## 🎯 Streaming con yt-dlp

Tutti i plugin utilizzano **yt-dlp** per l'estrazione video con formato:
- **`bestvideo+bestaudio/best`**: Qualità ottimale
- **Fallback automatici**: Se il formato migliore fallisce
- **Metadati completi**: Qualità, codec, durata
- **Streaming diretto**: URL diretti quando possibile

## 🚧 Roadmap

- [ ] Plugin Vimeo
- [ ] Plugin Twitch
- [ ] Plugin Dailymotion  
- [ ] Cache Redis per performance
- [ ] Rate limiting per API
- [ ] Web UI avanzata
- [ ] Supporto playlist
- [ ] Filtri avanzati ricerca

## 🤝 Contribuire

1. Fork del repository
2. Crea feature branch: `git checkout -b feature/nuovo-plugin`
3. Commit: `git commit -m 'Add: nuovo plugin'`
4. Push: `git push origin feature/nuovo-plugin`
5. Apri Pull Request

## 📄 Licenza

MIT License - vedi [LICENSE](LICENSE) per dettagli.

---

🎉 **Happy Streaming con OMG-Roma e l'architettura modulare!**