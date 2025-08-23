# 🎬 Sistema bestvideo+bestaudio - OMG-Roma

## 📋 Panoramica

Il sistema è stato aggiornato per utilizzare automaticamente **bestvideo+bestaudio** di yt-dlp, eliminando la necessità per l'utente di configurare manualmente la qualità video.

## ✨ Caratteristiche Principali

### 🔧 **Configurazione Automatica**
- ❌ **Rimossa**: Configurazione `quality_preference` dall'utente
- ✅ **Aggiunta**: Selezione automatica delle migliori qualità disponibili
- 🎯 **Obiettivo**: Sempre la migliore esperienza di streaming possibile

### 🎬 **Formati di Streaming Intelligenti**
- **🎬 Combined**: Formato migliore con video+audio integrato
- **🎬 Video Only**: Migliore qualità video disponibile
- **🎵 Audio Only**: Migliore qualità audio disponibile
- **📺 Proxy**: Fallback per compatibilità legacy

### 🚀 **Performance Ottimizzate**
- **URL Diretti**: Quando possibile, usa URL diretti di yt-dlp
- **Cache Intelligente**: Formati vengono cachati per 5 minuti
- **Fallback Robusto**: Se bestvideo+bestaudio fallisce, usa formati standard

## 🏗️ Architettura

```
Plugin YouTube → Gateway → yt-dlp → Formati Ottimali
     ↓              ↓         ↓           ↓
  Richiesta    Streaming  bestvideo+   Stremio
  Streaming    Manager    bestaudio    Player
```

### **1. Plugin YouTube**
- Gestisce richieste di streaming
- Chiama il gateway per i formati
- Presenta opzioni all'utente

### **2. Gateway (StreamingManager)**
- Coordina i servizi di streaming
- Normalizza i formati per i plugin
- Gestisce fallback e proxy

### **3. YtdlpService**
- Esegue yt-dlp con `bestvideo+bestaudio`
- Estrae formati ottimali
- Gestisce cache e timeout

## 🔧 Configurazione

### **Plugin YouTube**
```json
{
  "id": "youtube",
  "name": "YouTube",
  "version": "1.0.0",
  "config_schema": {
    "api_key": {
      "type": "string",
      "description": "YouTube Data API v3 Key"
    },
    "search_mode": {
      "type": "string",
      "enum": ["api", "ytdlp", "hybrid"],
      "default": "hybrid"
    },
    "followed_channels": {
      "type": "array",
      "description": "List of YouTube channel URLs"
    },
    "video_limit": {
      "type": "integer",
      "default": 20
    }
  }
}
```

### **Gateway Environment**
```bash
# Porta del gateway
PORT=3100

# Porta del plugin YouTube
PLUGIN_YOUTUBE_PORT=3001

# URL del gateway (per i plugin)
GATEWAY_URL=http://gateway:3100
```

## 🧪 Test del Sistema

### **Test Automatico**
```bash
# Installa dipendenze
npm install node-fetch

# Esegui test
node test-bestvideo-bestaudio.js
```

### **Test Manuale**
```bash
# 1. Test Gateway
curl http://localhost:3100/health

# 2. Test Plugin
curl http://localhost:3001/health

# 3. Test Streaming
curl -X POST http://localhost:3001/stream \
  -H "Content-Type: application/json" \
  -d '{"videoId":"dQw4w9WgXcQ"}'
```

## 📊 Log e Monitoraggio

### **Log Plugin YouTube**
```
🎬 Getting streams for: dQw4w9WgXcQ
✅ Found 4 stream options for: dQw4w9WgXcQ
```

### **Log Gateway**
```
🎬 yt-dlp formats per: dQw4w9WgXcQ (bestvideo+bestaudio)
✅ Stream URLs ottenuti per: dQw4w9WgXcQ
```

### **Log yt-dlp**
```
[yt-dlp] Downloading video info
[yt-dlp] Selecting bestvideo+bestaudio
[yt-dlp] Found 4 formats
```

## 🐛 Risoluzione Problemi

### **❌ Nessun Stream Trovato**
1. **Verifica yt-dlp**: `yt-dlp --version`
2. **Controlla log**: Cerca errori yt-dlp
3. **Testa manualmente**: `yt-dlp -F "VIDEO_URL"`

### **❌ Formati Non Ottimali**
1. **Verifica cache**: I formati sono cachati per 5 minuti
2. **Riavvia servizi**: Gateway e plugin
3. **Controlla parametri**: `-f bestvideo+bestaudio/best`

### **❌ Timeout yt-dlp**
1. **Aumenta timeout**: Modifica `timeout: 30000` in YtdlpService
2. **Verifica connessione**: Internet e accesso YouTube
3. **Testa con video diverso**: Alcuni video potrebbero essere problematici

## 🔄 Aggiornamenti e Manutenzione

### **Aggiornare yt-dlp**
```bash
# Aggiorna yt-dlp
pip install -U yt-dlp

# Verifica versione
yt-dlp --version
```

### **Pulizia Cache**
```bash
# La cache si pulisce automaticamente ogni 10 minuti
# Per pulizia manuale, riavvia il gateway
```

### **Monitoraggio Performance**
- **Tempo risposta**: Formati dovrebbero essere disponibili in <30s
- **Qualità formati**: Dovrebbero includere bestvideo+bestaudio
- **Fallback**: Proxy dovrebbe funzionare se formati diretti falliscono

## 🎯 Prossimi Sviluppi

### **Funzionalità Future**
- [ ] **HLS Streaming**: Supporto per streaming adattivo
- [ ] **Formati Avanzati**: 4K, HDR, Dolby Audio
- [ ] **Cache Distribuita**: Cache condivisa tra istanze
- [ ] **Metriche Avanzate**: Monitoraggio dettagliato performance

### **Ottimizzazioni**
- [ ] **Preload Formati**: Carica formati in background
- [ ] **Compressione Cache**: Riduce uso memoria
- [ ] **CDN Integration**: Distribuzione geografica formati

## 📚 Riferimenti

- **yt-dlp Documentation**: https://github.com/yt-dlp/yt-dlp
- **YouTube Data API**: https://developers.google.com/youtube/v3
- **Stremio Addon API**: https://github.com/Stremio/stremio-addon-sdk

---

**🎉 Il sistema bestvideo+bestaudio è ora attivo e funzionante!**

Per supporto o domande, consulta i log o esegui i test automatici.
