# 🎥 YouTube (OMG) - Addon Stremio

Un addon avanzato per Stremio che permette di cercare, esplorare e riprodurre video di YouTube direttamente nell'app con streaming HLS nativo e ricerca ibrida.

## 🌟 Caratteristiche Principali

### 🔍 **Ricerca Ibrida**
- **YouTube Data API**: Ricerca veloce e affidabile (richiede API Key)
- **yt-dlp Search**: Ricerca gratuita senza API Key (più lenta)
- **Switch Frontend**: Scegli la modalità direttamente dall'interfaccia web
- **Fallback Automatico**: Se l'API fallisce, passa automaticamente a yt-dlp

### 📺 **Canali Seguiti**
- **YouTube Discover**: Sezione dedicata ai tuoi canali preferiti
- **Filtri per Canale**: Visualizza video di un canale specifico
- **Vista Aggregata**: Tutti i video di tutti i canali seguiti
- **Metadati Consistenti**: Stessa struttura tra ricerca e discover

### 🎬 **Streaming Avanzato**
- **HLS Nativo**: Stream `.m3u8` supportati direttamente da Stremio
- **Formati Dinamici**: Fino a 6 formati diversi per video (360p-4K)
- **Qualità Adattiva**: MP4 con audio integrato e HLS streaming
- **Proxy Legacy**: Fallback per video non compatibili
- **URL Diretti**: Streaming diretto da YouTube senza proxy quando possibile

### 🎯 **Content Type Ottimizzato**
- **Tipo "Channel"**: Ottimizzato per contenuti YouTube in Stremio
- **Metadati Completi**: Titoli, descrizioni, durata, miniature
- **Icone Qualità**: Indicatori visivi per risoluzione e formato
- **Informazioni Codec**: AVC1, VP09, formato audio specificati

## 🚀 Installazione Rapida

### 1. Clona e Installa
```bash
git clone https://github.com/mccoy88f/OMG-YouTube.git
cd "OMG YouTube"
npm install
```

### 2. Installa yt-dlp (Raccomandato)
```bash
# macOS
brew install yt-dlp

# Ubuntu/Debian
sudo apt update && sudo apt install yt-dlp

# Windows
pip install yt-dlp

# Verifica installazione
yt-dlp --version
```

### 3. Avvia l'Addon
```bash
npm start
```

L'addon sarà disponibile su `http://localhost:3100`

## ⚙️ Configurazione

### 🌐 Interfaccia Web
1. Apri `http://localhost:3100` nel browser
2. **Modalità di Ricerca**:
   - **YouTube API**: Veloce, richiede API Key
   - **yt-dlp Search**: Gratuito, più lento
3. **API Key** (solo per modalità API):
   - Vai su [Google Cloud Console](https://console.cloud.google.com/)
   - Abilita YouTube Data v3 API
   - Crea una chiave API
4. **Canali Seguiti**: Aggiungi URL dei canali YouTube (uno per riga)
5. **Limite Video**: Imposta quanti video caricare (5-50)

### 📱 Installazione in Stremio
1. Configura l'addon nell'interfaccia web
2. Copia l'URL del manifest generato
3. In Stremio: **Addons → Community Addons**
4. Incolla l'URL del manifest
5. L'addon "YouTube (OMG)" apparirà nella sezione Channels

## 🔧 Come Funziona

### 🔍 Sistema di Ricerca
```
Ricerca Video → Modalità Scelta → Risultati
                ↓
    ┌─── YouTube API ────┐    ┌─── yt-dlp Search ───┐
    │ • Veloce (< 1s)    │    │ • Gratuito          │
    │ • 100 unità quota  │    │ • Lento (10-30s)    │
    │ • Metadati ricchi  │    │ • Ultimi 5 anni     │
    │ • Richiede API Key │    │ • Nessuna quota     │
    └────────────────────┘    └─────────────────────┘
```

### 🎬 Streaming Intelligente
```
Richiesta Stream → Analisi Formati → Selezione Ottimale
                           ↓
    ┌─── Formati Diretti ────┐    ┌─── Proxy Legacy ───┐
    │ • HLS (.m3u8) 📡      │    │ • Fallback 🔄      │
    │ • MP4 + Audio 🎵      │    │ • 3 qualità fisse   │
    │ • URL YouTube diretto │    │ • Proxy server      │
    │ • Fino a 6 opzioni    │    │ • Sempre funziona   │
    └───────────────────────┘    └────────────────────┘
```

### 📊 Qualità e Formati
- **👑 4K** (2160p+): Massima qualità
- **💎 1440p**: Alta qualità
- **🎬 1080p**: Full HD
- **📺 720p**: HD
- **📱 480p/360p**: Mobile/risparmio dati

**Indicatori Formato**:
- **🎵**: MP4 con audio integrato
- **📡**: HLS streaming adattivo
- **(legacy)**: Proxy server (fallback)

## 📁 Struttura del Progetto

```
src/
├── index.js              # Server principale e UI web
├── lib/
│   ├── config.js         # Gestione configurazione persistente
│   ├── youtube.js        # YouTube Data API v3
│   └── yt.js             # yt-dlp integration e search
data/
└── config.json          # Configurazione salvata
public/
├── favicon.ico          # Icona addon
└── favicon.png          # Logo Stremio
```

## 🌐 Endpoint API

### Core Stremio
- `GET /manifest.json` - Manifest addon (tipo "channel")
- `GET /catalog/channel/:id/:extra?.json` - Cataloghi video
- `GET /meta/channel/:id.json` - Metadati video completi
- `GET /stream/channel/:id.json` - Formati streaming disponibili

### Streaming
- `GET /proxy/channel/:id` - Proxy streaming (alta qualità)
- `GET /proxy-720/channel/:id` - Proxy 720p
- `GET /proxy-360/channel/:id` - Proxy 360p

### Amministrazione
- `GET /` - Interfaccia web di configurazione
- `GET /api/config` - Configurazione corrente
- `POST /api/config` - Salva configurazione
- `GET /api/yt-dlp-status` - Stato yt-dlp

## 🐛 Risoluzione Problemi

### ❌ Ricerca Non Funziona
**Modalità API**:
1. Verifica API Key valida
2. Controlla quota rimanente Google Cloud Console
3. Assicurati che YouTube Data v3 sia abilitata

**Modalità yt-dlp**:
1. Verifica installazione: `yt-dlp --version`
2. Aggiorna yt-dlp: `pip install -U yt-dlp`
3. Controlla connessione internet

### ❌ Video Non Si Aprono
1. **Formati Dinamici Falliti**: L'addon userà automaticamente proxy legacy
2. **Timeout yt-dlp**: Aumenta timeout o usa formati fissi
3. **Video Privati**: Alcuni video non sono accessibili pubblicamente
4. **Geo-blocking**: Alcuni contenuti potrebbero essere bloccati per regione

### ❌ Streaming Lento/Interrotto
1. **Usa HLS quando disponibile**: Formati 📡 sono più stabili
2. **Proxy Legacy**: Se HLS fallisce, usa formati (legacy)
3. **Connessione**: Verifica banda internet disponibile

## 📊 Logging e Monitoraggio

### Log Dettagliati
L'addon fornisce logging completo per debug:

```
🎥 OMG YouTube Addon Avviato!
🌐 Server in ascolto su: http://0.0.0.0:3100
✅ yt-dlp disponibile - Versione: 2024.08.06

🔍 Ricerca catalog richiesta: "tutorial"
🔧 Modalità ricerca: ytdlp
🚀 Usando yt-dlp search (gratuito)
✅ Ricerca completata: 25 video trovati

🎬 Stream request per video: ABC123
✅ 6 formati video disponibili su 44 totali
1. 📱 OMG YouTube - 360p AVC1 🎵
2. 🎬 OMG YouTube - 1080p AVC1 📡
```

### Monitoraggio Stato
- **✅ Successo**: Operazioni completate
- **🔄 Fallback**: Passaggio a sistema alternativo
- **❌ Errore**: Problemi che richiedono attenzione
- **⏰ Timeout**: Operazioni troppo lente

## 🔒 Sicurezza e Privacy

- **API Key**: Trasmessa via URL (standard Stremio)
- **Nessun Salvataggio Dati Utente**: Solo configurazione locale
- **Streaming Diretto**: URL YouTube originali quando possibile
- **Proxy Locale**: Solo per fallback, nessun server esterno
- **Open Source**: Codice completamente ispezionabile

## 🚀 Deployment Produzione

### Docker Compose
```yaml
version: '3.8'
services:
  omg-youtube:
    build: .
    ports:
      - "3100:3100"
    environment:
      - PUBLIC_HOST=https://yourdomain.com:3100
    volumes:
      - ./data:/app/data
```

### Variabili Ambiente
```bash
# Dominio pubblico per URL corretti
export PUBLIC_HOST="https://yourdomain.com:3100"

# Porta personalizzata
export PORT=3100
```

## 🎯 Roadmap e Funzionalità Future

### ✅ Implementato
- [x] Ricerca ibrida API/yt-dlp
- [x] Streaming HLS nativo
- [x] Formati dinamici multipli
- [x] Content type "channel"
- [x] Discover canali seguiti
- [x] Interfaccia web completa
- [x] Fallback automatici robusti

### 🔄 In Considerazione
- [ ] Cache intelligente risultati
- [ ] Supporto playlist YouTube
- [ ] Filtri avanzati (durata, data)
- [ ] Statistiche utilizzo
- [ ] Supporto YouTube Shorts
- [ ] Integrazione YouTube Music

## 🤝 Contributi

Le contribuzioni sono benvenute! 

1. **Fork** il repository
2. **Crea** un branch per la tua feature
3. **Commit** le modifiche con messaggi chiari
4. **Push** e apri una **Pull Request**

### Linee Guida
- Mantieni compatibilità Stremio
- Testa sia modalità API che yt-dlp
- Aggiungi logging appropriato
- Documenta nuove funzionalità

## 📄 Licenza

Questo progetto è rilasciato sotto **licenza MIT**.

## 🎨 Attribuzioni

### Icona dell'App
- **Icona**: Play button by Freepik
- **Fonte**: [Flaticon](https://www.flaticon.com/free-icon/play_10090287)
- **Licenza**: Flaticon License

## 🆘 Supporto

Per problemi o domande:

1. **Controlla i Log**: Informazioni dettagliate nel terminale
2. **Verifica Stato**: Usa l'interfaccia web su `http://localhost:3100`
3. **Issues GitHub**: [Apri una issue](https://github.com/mccoy88f/OMG-YouTube/issues)
4. **Wiki**: Documentazione aggiuntiva nel repository

---

**🎉 Goditi YouTube su Stremio con streaming nativo e ricerca ibrida!**