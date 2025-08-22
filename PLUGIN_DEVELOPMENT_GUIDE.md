# 🚀 Guida allo Sviluppo Plugin per OMG-Roma

## 📋 Indice
- [Panoramica](#-panoramica)
- [Struttura di un Plugin](#-struttura-di-un-plugin)
- [Creazione di un Nuovo Plugin](#-creazione-di-un-nuovo-plugin)
- [Implementazione degli Endpoint](#-implementazione-degli-endpoint)
- [Configurazione Docker](#-configurazione-docker)
- [Test e Debug](#-test-e-debug)
- [Distribuzione](#-distribuzione)

---

## 🌟 Panoramica

OMG-Roma è un sistema modulare per addon Stremio che permette di creare plugin personalizzati per diverse piattaforme di contenuti. Ogni plugin è un container Docker indipendente che comunica con il gateway principale.

### 🎯 Caratteristiche Principali
- **Architettura modulare**: Ogni plugin è un servizio Docker separato
- **Comunicazione HTTP**: Plugin e gateway comunicano via REST API
- **Health checking**: Sistema di monitoraggio automatico dello stato
- **Configurazione dinamica**: Plugin configurabili tramite file JSON
- **Integrazione Stremio**: Compatibile con il protocollo Stremio

---

## 🏗️ Struttura di un Plugin

```
plugins/
└── my-plugin/
    ├── Dockerfile                 # Configurazione container
    ├── package.json              # Dipendenze Node.js
    ├── plugin.json               # Metadati del plugin
    ├── health-check.sh           # Script di health check
    └── src/
        ├── index.js              # Server principale
        ├── config-manager.js     # Gestione configurazione
        └── service.js            # Logica di business
```

### 📁 File Principali

#### `plugin.json`
```json
{
  "id": "my-plugin",
  "name": "My Plugin",
  "version": "1.0.0",
  "description": "Descrizione del plugin",
  "author": "Il tuo nome",
  "port": 3002,
  "endpoints": {
    "search": "/search",
    "discover": "/discover",
    "meta": "/meta",
    "stream": "/stream"
  },
  "stremio": {
    "search_catalog_name": "Ricerca My Plugin",
    "search_catalog_id": "my_plugin_search",
    "discover_catalog_name": "My Plugin Discover",
    "discover_catalog_id": "my_plugin_discover"
  }
}
```

#### `package.json`
```json
{
  "name": "my-plugin",
  "version": "1.0.0",
  "main": "src/index.js",
  "scripts": {
    "start": "node src/index.js",
    "dev": "nodemon src/index.js"
  },
  "dependencies": {
    "express": "^4.18.2",
    "axios": "^1.5.0"
  }
}
```

---

## 🆕 Creazione di un Nuovo Plugin

### 1. **Crea la Directory del Plugin**
```bash
mkdir -p plugins/my-plugin/src
cd plugins/my-plugin
```

### 2. **Inizializza il Progetto**
```bash
npm init -y
npm install express axios
```

### 3. **Crea il File Principale** (`src/index.js`)
```javascript
const express = require('express');
const app = express();
const PORT = process.env.PORT || 3002;

// Middleware
app.use(express.json());

// Plugin info endpoint (OBBLIGATORIO)
app.get('/plugin.json', (req, res) => {
  try {
    const pluginInfo = require('../plugin.json');
    res.json(pluginInfo);
  } catch (error) {
    res.status(404).json({ error: 'Plugin info not found' });
  }
});

// Health check endpoint (OBBLIGATORIO)
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    plugin: 'my-plugin',
    version: '1.0.0'
  });
});

// Readiness check endpoint (RACCOMANDATO)
app.get('/ready', (req, res) => {
  res.json({
    status: 'ready',
    timestamp: new Date().toISOString(),
    plugin: 'my-plugin'
  });
});

// Endpoint di ricerca (per Stremio)
app.post('/search', async (req, res) => {
  try {
    const { search, skip = 0, limit = 20 } = req.body;
    
    // Implementa la logica di ricerca
    const results = await performSearch(search, { skip, limit });
    
    res.json({
      videos: results.videos,
      hasMore: results.hasMore
    });
  } catch (error) {
    res.status(500).json({ 
      error: 'Search failed', 
      details: error.message 
    });
  }
});

// Endpoint discover (per Stremio)
app.post('/discover', async (req, res) => {
  try {
    const { skip = 0, limit = 20 } = req.body;
    
    // Implementa la logica di discover
    const results = await performDiscover({ skip, limit });
    
    res.json({
      videos: results.videos,
      hasMore: results.hasMore
    });
  } catch (error) {
    res.status(500).json({ 
      error: 'Discover failed', 
      details: error.message 
    });
  }
});

// Endpoint meta (per Stremio)
app.post('/meta', async (req, res) => {
  try {
    const { videoId } = req.body;
    
    // Recupera i metadati del video
    const video = await getVideoMeta(videoId);
    
    if (!video) {
      return res.status(404).json({ error: 'Video not found' });
    }
    
    res.json({ video });
  } catch (error) {
    res.status(500).json({ 
      error: 'Failed to get video metadata', 
      details: error.message 
    });
  }
});

// Endpoint stream (per Stremio)
app.post('/stream', async (req, res) => {
  try {
    const { videoId } = req.body;
    
    // Recupera gli stream disponibili
    const streams = await getVideoStreams(videoId);
    
    res.json({ streams: streams || [] });
  } catch (error) {
    res.status(500).json({ 
      error: 'Failed to get video streams', 
      details: error.message,
      streams: []
    });
  }
});

// Funzioni helper (implementa secondo le tue esigenze)
async function performSearch(query, options) {
  // TODO: Implementa la logica di ricerca
  return { videos: [], hasMore: false };
}

async function performDiscover(options) {
  // TODO: Implementa la logica di discover
  return { videos: [], hasMore: false };
}

async function getVideoMeta(videoId) {
  // TODO: Implementa il recupero metadati
  return null;
}

async function getVideoStreams(videoId) {
  // TODO: Implementa il recupero stream
  return [];
}

// Avvia il server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🌐 My Plugin listening on: http://0.0.0.0:${PORT}`);
  console.log(`✅ Plugin is ready to accept requests`);
});
```

---

## 🔧 Implementazione degli Endpoint

### 📋 Endpoint Obbligatori

#### `/plugin.json`
- **Metodo**: `GET`
- **Scopo**: Fornisce i metadati del plugin
- **Risposta**: File `plugin.json` del plugin

#### `/health`
- **Metodo**: `GET`
- **Scopo**: Verifica lo stato di salute del plugin
- **Risposta**: Status "healthy" con timestamp

#### `/ready`
- **Metodo**: `GET`
- **Scopo**: Verifica se il plugin è pronto per le richieste
- **Risposta**: Status "ready" o "not_ready"

### 🎯 Endpoint Stremio

#### `/search`
- **Metodo**: `POST`
- **Parametri**: `{ search, skip, limit }`
- **Risposta**: `{ videos: [], hasMore: boolean }`

#### `/discover`
- **Metodo**: `POST`
- **Parametri**: `{ skip, limit }`
- **Risposta**: `{ videos: [], hasMore: boolean }`

#### `/meta`
- **Metodo**: `POST`
- **Parametri**: `{ videoId }`
- **Risposta**: `{ video: {...} }`

#### `/stream`
- **Metodo**: `POST`
- **Parametri**: `{ videoId }`
- **Risposta**: `{ streams: [...] }`

---

## 🐳 Configurazione Docker

### 1. **Crea il Dockerfile**
```dockerfile
FROM node:20-bookworm-slim

# Installa dipendenze di sistema
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    bash \
  && rm -rf /var/lib/apt/lists/*

# Crea directory app
WORKDIR /app

# Copia package files
COPY package*.json ./

# Installa dipendenze
RUN npm ci --only=production --no-audit --no-fund

# Copia codice sorgente
COPY src/ ./src/
COPY plugin.json ./

# Crea script health check
RUN echo '#!/bin/bash\nresponse=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3002/ready)\nif [ "$response" = "200" ]; then\n    echo "✅ Plugin is ready"\n    exit 0\nelse\n    echo "❌ Plugin not ready (HTTP: $response)"\n    exit 1\nfi' > /app/health-check.sh && chmod +x /app/health-check.sh

# Crea utente non-root
RUN groupadd --gid 1001 nodejs && \
    useradd --uid 1001 --gid nodejs --shell /bin/bash --create-home nodejs

# Cambia ownership
RUN chown -R nodejs:nodejs /app

# Switch a utente non-root
USER nodejs

# Esponi porta
EXPOSE 3002

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD /app/health-check.sh

# Avvia applicazione
CMD ["node", "src/index.js"]
```

### 2. **Aggiorna docker-compose.yml**
```yaml
services:
  # ... altri servizi ...
  
  my-plugin:
    build: 
      context: .
      dockerfile: plugins/my-plugin/Dockerfile
    container_name: omg-my-plugin
    ports:
      - "3002:3002"
    environment:
      - PORT=3002
    networks:
      - omg-roma-network
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3002/ready"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s
```

### 3. **Aggiorna config/plugins.json**
```json
{
  "plugins": {
    "youtube": {
      "enabled": true,
      "container": "youtube-plugin",
      "port": 3001
    },
    "my-plugin": {
      "enabled": true,
      "container": "my-plugin",
      "port": 3002
    }
  }
}
```

---

## 🧪 Test e Debug

### 1. **Test Locale**
```bash
cd plugins/my-plugin
npm start
```

### 2. **Test Endpoint**
```bash
# Test plugin.json
curl http://localhost:3002/plugin.json

# Test health
curl http://localhost:3002/health

# Test search
curl -X POST http://localhost:3002/search \
  -H "Content-Type: application/json" \
  -d '{"search":"test","skip":0,"limit":10}'
```

### 3. **Test con Docker**
```bash
# Build e avvia
docker-compose up --build my-plugin

# Verifica logs
docker-compose logs -f my-plugin

# Test health check
docker-compose exec my-plugin curl http://localhost:3002/ready
```

### 4. **Debug nel Codice**
```javascript
// Aggiungi logging dettagliato
app.post('/search', async (req, res) => {
  try {
    console.log('🔍 Search request received:', req.body);
    
    const { search, skip = 0, limit = 20 } = req.body;
    console.log(`📝 Searching for: "${search}" (skip: ${skip}, limit: ${limit})`);
    
    // ... logica di ricerca ...
    
    console.log(`✅ Search completed: ${results.videos.length} videos found`);
    res.json(results);
  } catch (error) {
    console.error('❌ Search error:', error);
    res.status(500).json({ error: error.message });
  }
});
```

---

## 📦 Distribuzione

### 1. **Commit e Push**
```bash
git add plugins/my-plugin/
git commit -m "Add my-plugin: [descrizione breve]"
git push origin main
```

### 2. **Deploy su Portainer**
- Carica il codice nel repository
- Usa il docker-compose.yml aggiornato
- Avvia i container

### 3. **Verifica Funzionamento**
- Controlla i log del gateway
- Verifica che il plugin sia "healthy"
- Testa gli endpoint Stremio

---

## 🎯 Best Practices

### ✅ **Cosa Fare**
- **Usa nomi container univoci** con prefisso `omg-`
- **Implementa sempre** gli endpoint obbligatori
- **Gestisci gli errori** con try-catch appropriati
- **Usa logging consistente** con emoji per facilità di lettura
- **Implementa health check** robusti
- **Valida i parametri** di input

### ❌ **Cosa Evitare**
- **Non duplicare endpoint** con lo stesso percorso
- **Non esporre porte** non necessarie all'esterno
- **Non usare utenti root** nei container
- **Non dimenticare** la gestione degli errori
- **Non hardcodare** configurazioni

---

## 🔍 Troubleshooting

### Problemi Comuni

#### **Plugin non raggiungibile**
- Verifica che il container sia in esecuzione
- Controlla i log per errori di avvio
- Verifica la configurazione del network Docker

#### **Endpoint restituisce 404**
- Controlla che l'endpoint sia registrato correttamente
- Verifica che non ci siano duplicati
- Controlla i log per errori JavaScript

#### **Health check fallisce**
- Verifica che l'endpoint `/ready` funzioni
- Controlla che curl sia installato nel container
- Verifica i timeout e intervalli

#### **Gateway non si connette**
- Verifica i nomi dei container
- Controlla la configurazione del network
- Verifica che le porte siano mappate correttamente

---

## 📚 Risorse Utili

- **Repository OMG-Roma**: [GitHub](https://github.com/mccoy88f/OMG-Roma)
- **Documentazione Express**: [expressjs.com](https://expressjs.com/)
- **Docker Best Practices**: [docs.docker.com](https://docs.docker.com/)
- **Stremio Protocol**: [github.com/Stremio](https://github.com/Stremio)

---

## 🤝 Contribuire

1. **Fork** il repository
2. **Crea** un branch per il tuo plugin
3. **Implementa** seguendo questa guida
4. **Testa** localmente e con Docker
5. **Crea** una Pull Request

---

## 📞 Supporto

Per domande o problemi:
- **Issues**: [GitHub Issues](https://github.com/mccoy88f/OMG-Roma/issues)
- **Discussions**: [GitHub Discussions](https://github.com/mccoy88f/OMG-Roma/discussions)

---

**Buona programmazione! 🚀**
