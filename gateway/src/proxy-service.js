const http = require('http');
const https = require('https');
const { URL } = require('url');
const fs = require('fs-extra');
const path = require('path');

class ProxyService {
  constructor() {
    this.cacheDir = path.join(__dirname, '../cache/proxy');
    this.streamCache = new Map();
    this.cacheTimeout = 10 * 60 * 1000; // 10 minuti
    this.maxCacheSize = 500; // Max 500 stream in cache
    this.maxConcurrentStreams = 10; // Max 10 stream simultanei
    this.activeStreams = 0;
    
    this.ensureCacheDir();
    this.startCleanupInterval();
  }

  async ensureCacheDir() {
    try {
      await fs.ensureDir(this.cacheDir);
      console.log('📁 Cache directory proxy creata:', this.cacheDir);
    } catch (error) {
      console.error('❌ Errore creazione cache directory proxy:', error);
    }
  }

  startCleanupInterval() {
    // Pulisce la cache ogni 15 minuti
    setInterval(() => {
      this.cleanupCache();
    }, 15 * 60 * 1000);
  }

  cleanupCache() {
    const now = Date.now();
    let cleaned = 0;
    
    for (const [key, value] of this.streamCache.entries()) {
      if (now - value.timestamp > this.cacheTimeout) {
        this.streamCache.delete(key);
        cleaned++;
      }
    }
    
    if (cleaned > 0) {
      console.log(`🧹 Cache proxy pulita: ${cleaned} elementi rimossi`);
    }
  }

  // Gestione stream attivi
  canStartStream() {
    return this.activeStreams < this.maxConcurrentStreams;
  }

  startStream() {
    if (this.canStartStream()) {
      this.activeStreams++;
      return true;
    }
    return false;
  }

  endStream() {
    if (this.activeStreams > 0) {
      this.activeStreams--;
    }
  }

  // Proxy per streaming video
  async proxyStream(url, quality = 'best', req, res) {
    if (!this.canStartStream()) {
      return res.status(503).json({ 
        error: 'Too many concurrent streams',
        message: 'Server overloaded, try again later'
      });
    }

    try {
      this.startStream();
      console.log(`🎬 Proxy stream: ${url} (qualità: ${quality})`);

      const streamUrl = await this.resolveStreamUrl(url, quality);
      
      if (!streamUrl) {
        throw new Error('Impossibile risolvere URL stream');
      }

      // Imposta headers per streaming
      res.setHeader('Content-Type', 'video/mp4');
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Cache-Control', 'public, max-age=3600');
      res.setHeader('Access-Control-Allow-Origin', '*');

      // Proxy dello stream
      await this.pipeStream(streamUrl, res);
      
    } catch (error) {
      console.error('❌ Errore proxy stream:', error);
      res.status(500).json({ 
        error: 'Streaming failed',
        details: error.message
      });
    } finally {
      this.endStream();
    }
  }

  // Risolve URL stream con qualità specifica
  async resolveStreamUrl(url, quality) {
    try {
      const urlObj = new URL(url);
      
      // Se è già un URL diretto, usalo
      if (urlObj.protocol === 'http:' || urlObj.protocol === 'https:') {
        return url;
      }

      // Se è un URL YouTube, risolvi con yt-dlp
      if (url.includes('youtube.com') || url.includes('youtu.be')) {
        return await this.resolveYouTubeUrl(url, quality);
      }

      // Per altri servizi, prova a risolvere direttamente
      return url;
      
    } catch (error) {
      console.error('❌ Errore risoluzione URL stream:', error);
      return null;
    }
  }

  // Risolve URL YouTube con qualità specifica
  async resolveYouTubeUrl(videoId, quality) {
    try {
      // Qui useremo il servizio yt-dlp centralizzato
      // Per ora restituiamo l'URL originale
      return videoId;
    } catch (error) {
      console.error('❌ Errore risoluzione YouTube URL:', error);
      return null;
    }
  }

  // Piping dello stream
  async pipeStream(sourceUrl, res) {
    return new Promise((resolve, reject) => {
      const urlObj = new URL(sourceUrl);
      const client = urlObj.protocol === 'https:' ? https : http;
      
      const request = client.get(sourceUrl, (response) => {
        // Controlla status code
        if (response.statusCode !== 200) {
          reject(new Error(`HTTP ${response.statusCode}: ${response.statusMessage}`));
          return;
        }

        // Imposta headers di risposta
        if (response.headers['content-length']) {
          res.setHeader('Content-Length', response.headers['content-length']);
        }
        if (response.headers['content-type']) {
          res.setHeader('Content-Type', response.headers['content-type']);
        }

        // Pipe dello stream
        response.pipe(res);
        
        response.on('end', () => {
          console.log('✅ Stream completato');
          resolve();
        });
        
        response.on('error', (error) => {
          console.error('❌ Errore stream response:', error);
          reject(error);
        });
      });

      request.on('error', (error) => {
        console.error('❌ Errore request:', error);
        reject(error);
      });

      // Timeout di sicurezza
      request.setTimeout(30000, () => {
        request.destroy();
        reject(new Error('Request timeout'));
      });

      // Gestione chiusura connessione
      req.on('close', () => {
        request.destroy();
      });
    });
  }

  // Proxy per formati multipli
  async getStreamFormats(videoId, source = 'youtube') {
    const cacheKey = `formats_${source}_${videoId}`;
    const cached = this.streamCache.get(cacheKey);
    
    if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
      return cached.data;
    }

    try {
      let formats = [];
      
      if (source === 'youtube') {
        formats = await this.getYouTubeFormats(videoId);
      } else {
        formats = await this.getGenericFormats(videoId);
      }

      // Salva in cache
      this.streamCache.set(cacheKey, {
        data: formats,
        timestamp: Date.now()
      });

      return formats;
      
    } catch (error) {
      console.error('❌ Errore ottenimento formati:', error);
      return [];
    }
  }

  // Formati YouTube specifici
  async getYouTubeFormats(videoId) {
    // Qui useremo il servizio yt-dlp centralizzato
    // Per ora restituiamo formati di esempio
    return [
      {
        quality: '4K',
        height: 2160,
        url: `/proxy/stream/${videoId}?quality=4k`,
        type: 'hls',
        label: '4K Ultra HD'
      },
      {
        quality: '1080p',
        height: 1080,
        url: `/proxy/stream/${videoId}?quality=1080p`,
        type: 'mp4',
        label: 'Full HD'
      },
      {
        quality: '720p',
        height: 720,
        url: `/proxy/stream/${videoId}?quality=720p`,
        type: 'mp4',
        label: 'HD'
      },
      {
        quality: '480p',
        height: 480,
        url: `/proxy/stream/${videoId}?quality=480p`,
        type: 'mp4',
        label: 'SD'
      }
    ];
  }

  // Formati generici per altri servizi
  async getGenericFormats(videoId) {
    return [
      {
        quality: 'best',
        url: `/proxy/stream/${videoId}?quality=best`,
        type: 'auto',
        label: 'Migliore qualità disponibile'
      },
      {
        quality: 'worst',
        url: `/proxy/stream/${videoId}?quality=worst`,
        type: 'auto',
        label: 'Qualità minima'
      }
    ];
  }

  // Proxy per download
  async proxyDownload(url, filename, req, res) {
    try {
      console.log(`📥 Proxy download: ${url} -> ${filename}`);

      const streamUrl = await this.resolveStreamUrl(url, 'best');
      
      if (!streamUrl) {
        throw new Error('Impossibile risolvere URL download');
      }

      // Imposta headers per download
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Cache-Control', 'no-cache');

      // Proxy del download
      await this.pipeStream(streamUrl, res);
      
    } catch (error) {
      console.error('❌ Errore proxy download:', error);
      res.status(500).json({ 
        error: 'Download failed',
        details: error.message
      });
    }
  }

  // Proxy per thumbnail
  async proxyThumbnail(url, req, res) {
    try {
      console.log(`🖼️ Proxy thumbnail: ${url}`);

      // Imposta headers per immagine
      res.setHeader('Content-Type', 'image/jpeg');
      res.setHeader('Cache-Control', 'public, max-age=86400'); // 24 ore
      res.setHeader('Access-Control-Allow-Origin', '*');

      // Proxy della thumbnail
      await this.pipeStream(url, res);
      
    } catch (error) {
      console.error('❌ Errore proxy thumbnail:', error);
      res.status(500).json({ 
        error: 'Thumbnail failed',
        details: error.message
      });
    }
  }

  // Proxy per sottotitoli
  async proxySubtitles(url, language = 'en', req, res) {
    try {
      console.log(`📝 Proxy subtitles: ${url} (${language})`);

      // Imposta headers per sottotitoli
      res.setHeader('Content-Type', 'text/plain');
      res.setHeader('Cache-Control', 'public, max-age=3600');
      res.setHeader('Access-Control-Allow-Origin', '*');

      // Proxy dei sottotitoli
      await this.pipeStream(url, res);
      
    } catch (error) {
      console.error('❌ Errore proxy subtitles:', error);
      res.status(500).json({ 
        error: 'Subtitles failed',
        details: error.message
      });
    }
  }

  // Health check
  async healthCheck() {
    try {
      const cacheSize = this.streamCache.size;
      const activeStreams = this.activeStreams;
      const maxStreams = this.maxConcurrentStreams;
      
      return {
        status: 'healthy',
        streams: {
          active: activeStreams,
          max: maxStreams,
          available: maxStreams - activeStreams
        },
        cache: {
          size: cacheSize,
          maxSize: this.maxCacheSize,
          timeout: this.cacheTimeout
        },
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      return {
        status: 'error',
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }

  // Statistiche utilizzo
  getUsageStats() {
    return {
      activeStreams: this.activeStreams,
      maxConcurrentStreams: this.maxConcurrentStreams,
      cacheSize: this.streamCache.size,
      cacheHitRate: this.getCacheHitRate(),
      uptime: process.uptime()
    };
  }

  getCacheHitRate() {
    // Implementazione semplificata
    return 0.8; // 80% hit rate stimato
  }

  // Cleanup
  async shutdown() {
    console.log('🛑 ProxyService shutdown...');
    this.streamCache.clear();
    this.activeStreams = 0;
  }
}

module.exports = ProxyService;
