const YtdlpService = require('./ytdlp-service');
const ProxyService = require('./proxy-service');

class StreamingManager {
  constructor() {
    this.ytdlpService = new YtdlpService();
    this.proxyService = new ProxyService();
    this.pluginStreams = new Map(); // Traccia stream per plugin
    
    console.log('🎬 StreamingManager inizializzato');
  }

  // Inizializzazione
  async initialize() {
    try {
      console.log('🚀 Inizializzazione StreamingManager...');
      
      // Verifica disponibilità yt-dlp
      const ytdlpAvailable = await this.ytdlpService.checkYtdlpAvailability();
      if (!ytdlpAvailable) {
        console.warn('⚠️ yt-dlp non disponibile, alcune funzionalità potrebbero non funzionare');
      }
      
      console.log('✅ StreamingManager inizializzato correttamente');
      return true;
      
    } catch (error) {
      console.error('❌ Errore inizializzazione StreamingManager:', error);
      return false;
    }
  }

  // Ricerca video per plugin
  async searchVideos(pluginId, query, options = {}) {
    try {
      console.log(`🔍 StreamingManager: ricerca per plugin ${pluginId}: "${query}"`);
      
      // Usa il servizio yt-dlp centralizzato
      const results = await this.ytdlpService.searchVideos(query, options);
      
      // Traccia utilizzo per plugin
      this.trackPluginUsage(pluginId, 'search', { query, results: results.videos.length });
      
      return results;
      
    } catch (error) {
      console.error(`❌ Errore ricerca per plugin ${pluginId}:`, error);
      throw error;
    }
  }

  // Ottieni info video per plugin
  async getVideoInfo(pluginId, videoId) {
    try {
      console.log(`📝 StreamingManager: info video per plugin ${pluginId}: ${videoId}`);
      
      // Usa il servizio yt-dlp centralizzato
      const videoInfo = await this.ytdlpService.getVideoInfo(videoId);
      
      // Traccia utilizzo per plugin
      this.trackPluginUsage(pluginId, 'info', { videoId });
      
      return videoInfo;
      
    } catch (error) {
      console.error(`❌ Errore info video per plugin ${pluginId}:`, error);
      throw error;
    }
  }

  // Ottieni formati streaming per plugin
  async getStreamFormats(pluginId, videoId, source = 'youtube') {
    try {
      console.log(`🎬 StreamingManager: formati per plugin ${pluginId}: ${videoId}`);
      
      // Ottieni formati base
      let formats = [];
      
      if (source === 'youtube') {
        // Usa yt-dlp per formati YouTube
        const videoInfo = await this.ytdlpService.getVideoFormats(videoId);
        formats = this.normalizeFormatsForPlugin(pluginId, videoInfo, videoId);
      } else {
        // Usa proxy service per altri servizi
        formats = await this.proxyService.getStreamFormats(videoId, source);
      }
      
      // Traccia utilizzo per plugin
      this.trackPluginUsage(pluginId, 'formats', { videoId, formatsCount: formats.length });
      
      return formats;
      
    } catch (error) {
      console.error(`❌ Errore formati per plugin ${pluginId}:`, error);
      throw error;
    }
  }

  // Normalizza formati per plugin specifico con bestvideo+bestaudio
  normalizeFormatsForPlugin(pluginId, ytdlpFormats, videoId) {
    const formats = [];
    const gatewayUrl = process.env.GATEWAY_URL || 'http://gateway:3100';
    
    for (const format of ytdlpFormats) {
      if (format.url) {
        // Per formati ottimali (bestvideo+bestaudio), usa URL diretti quando possibile
        if (format.type === 'combined') {
          formats.push({
            url: format.url,
            ext: format.ext,
            quality: format.quality,
            width: format.width || 0,
            height: format.height || 0,
            fps: format.fps || 0,
            filesize: format.filesize || 0,
            vcodec: format.vcodec || 'none',
            acodec: format.acodec || 'none',
            label: format.label,
            type: 'direct'
          });
        } else if (format.type === 'video' || format.type === 'audio') {
          // Per formati separati (bestvideo o bestaudio), usa anche URL diretti
          formats.push({
            url: format.url,
            ext: format.ext,
            quality: format.quality,
            width: format.width || 0,
            height: format.height || 0,
            fps: format.fps || 0,
            filesize: format.filesize || 0,
            vcodec: format.vcodec || 'none',
            acodec: format.acodec || 'none',
            label: format.label,
            type: format.type
          });
        } else {
          // Fallback: crea URL proxy per formati legacy
          const proxyUrl = `${gatewayUrl}/api/streaming/${pluginId}/proxy/${videoId}?format=${format.ext}&quality=${format.height}p`;
          
          formats.push({
            url: proxyUrl,
            ext: format.ext,
            quality: format.height + 'p',
            width: format.width || 0,
            height: format.height || 0,
            fps: format.fps || 0,
            filesize: format.filesize || 0,
            vcodec: format.vcodec || 'none',
            acodec: format.acodec || 'none',
            label: `${format.height}p${format.fps > 30 ? ' ' + format.fps + 'fps' : ''}`,
            type: 'proxy'
          });
        }
      }
    }
    
    // Ordina: combinati prima, poi video, poi audio, poi proxy
    formats.sort((a, b) => {
      const typeOrder = { 'combined': 0, 'video': 1, 'audio': 2, 'proxy': 3 };
      const typeA = typeOrder[a.type] || 3;
      const typeB = typeOrder[b.type] || 3;
      
      if (typeA !== typeB) {
        return typeA - typeB;
      }
      
      // Per lo stesso tipo, ordina per qualità
      const heightA = parseInt(a.height) || 0;
      const heightB = parseInt(b.height) || 0;
      return heightB - heightA;
    });
    
    return formats;
  }

  // Stream video per plugin
  async streamVideo(pluginId, videoId, format, quality, req, res) {
    try {
      console.log(`🎬 StreamingManager: stream per plugin ${pluginId}: ${videoId} (${quality})`);
      
      // Traccia inizio stream
      this.trackPluginUsage(pluginId, 'stream_start', { videoId, quality });
      
      // Ottieni URL stream diretto da yt-dlp
      const videoInfo = await this.ytdlpService.getVideoInfo(videoId);
      
      if (!videoInfo || !videoInfo.formats) {
        throw new Error('Formati video non disponibili');
      }
      
      // Trova il formato richiesto
      let targetFormat = null;
      if (quality === 'best') {
        targetFormat = videoInfo.formats[0]; // Primo = migliore qualità
      } else {
        targetFormat = videoInfo.formats.find(f => 
          f.height && f.height.toString() === quality.replace('p', '')
        );
      }
      
      if (!targetFormat || !targetFormat.url) {
        throw new Error(`Formato ${quality} non disponibile`);
      }
      
      // Usa proxy service per lo streaming
      await this.proxyService.proxyStream(targetFormat.url, quality, req, res);
      
      // Traccia completamento stream
      this.trackPluginUsage(pluginId, 'stream_complete', { videoId, quality });
      
    } catch (error) {
      console.error(`❌ Errore stream per plugin ${pluginId}:`, error);
      
      // Traccia errore stream
      this.trackPluginUsage(pluginId, 'stream_error', { videoId, quality, error: error.message });
      
      throw error;
    }
  }

  // Video da canale per plugin
  async getChannelVideos(pluginId, channelUrl, options = {}) {
    try {
      console.log(`📺 StreamingManager: channel videos per plugin ${pluginId}: ${channelUrl}`);
      
      // Usa il servizio yt-dlp centralizzato
      const results = await this.ytdlpService.getChannelVideos(channelUrl, options);
      
      // Traccia utilizzo per plugin
      this.trackPluginUsage(pluginId, 'channel_videos', { 
        channelUrl, 
        videosCount: results.length 
      });
      
      return results;
      
    } catch (error) {
      console.error(`❌ Errore channel videos per plugin ${pluginId}:`, error);
      throw error;
    }
  }

  // Download video per plugin
  async downloadVideo(pluginId, videoId, format, req, res) {
    try {
      console.log(`📥 StreamingManager: download per plugin ${pluginId}: ${videoId}`);
      
      // Traccia inizio download
      this.trackPluginUsage(pluginId, 'download_start', { videoId, format });
      
      // Ottieni URL download da yt-dlp
      const videoInfo = await this.ytdlpService.getVideoInfo(videoId);
      
      if (!videoInfo || !videoInfo.url) {
        throw new Error('URL download non disponibile');
      }
      
      // Genera nome file
      const filename = `${videoInfo.title || videoId}.${format || 'mp4'}`;
      
      // Usa proxy service per il download
      await this.proxyService.proxyDownload(videoInfo.url, filename, req, res);
      
      // Traccia completamento download
      this.trackPluginUsage(pluginId, 'download_complete', { videoId, format });
      
    } catch (error) {
      console.error(`❌ Errore download per plugin ${pluginId}:`, error);
      
      // Traccia errore download
      this.trackPluginUsage(pluginId, 'download_error', { videoId, format, error: error.message });
      
      throw error;
    }
  }

  // Thumbnail per plugin
  async getThumbnail(pluginId, videoId, req, res) {
    try {
      console.log(`🖼️ StreamingManager: thumbnail per plugin ${pluginId}: ${videoId}`);
      
      // Ottieni info video per thumbnail
      const videoInfo = await this.ytdlpService.getVideoInfo(videoId);
      
      if (!videoInfo || !videoInfo.thumbnail) {
        throw new Error('Thumbnail non disponibile');
      }
      
      // Usa proxy service per la thumbnail
      await this.proxyService.proxyThumbnail(videoInfo.thumbnail, req, res);
      
      // Traccia utilizzo per plugin
      this.trackPluginUsage(pluginId, 'thumbnail', { videoId });
      
    } catch (error) {
      console.error(`❌ Errore thumbnail per plugin ${pluginId}:`, error);
      throw error;
    }
  }

  // Sottotitoli per plugin
  async getSubtitles(pluginId, videoId, language = 'en', req, res) {
    try {
      console.log(`📝 StreamingManager: subtitles per plugin ${pluginId}: ${videoId} (${language})`);
      
      // Ottieni info video per sottotitoli
      const videoInfo = await this.ytdlpService.getVideoInfo(videoId);
      
      if (!videoInfo || !videoInfo.subtitles || !videoInfo.subtitles[language]) {
        throw new Error(`Sottotitoli ${language} non disponibili`);
      }
      
      const subtitleUrl = videoInfo.subtitles[language][0].url;
      
      // Usa proxy service per i sottotitoli
      await this.proxyService.proxySubtitles(subtitleUrl, language, req, res);
      
      // Traccia utilizzo per plugin
      this.trackPluginUsage(pluginId, 'subtitles', { videoId, language });
      
    } catch (error) {
      console.error(`❌ Errore sottotitoli per plugin ${pluginId}:`, error);
      throw error;
    }
  }

  // Tracciamento utilizzo per plugin
  trackPluginUsage(pluginId, operation, data) {
    if (!this.pluginStreams.has(pluginId)) {
      this.pluginStreams.set(pluginId, {
        operations: [],
        lastActivity: Date.now()
      });
    }
    
    const pluginData = this.pluginStreams.get(pluginId);
    pluginData.operations.push({
      operation,
      data,
      timestamp: Date.now()
    });
    
    pluginData.lastActivity = Date.now();
    
    // Mantieni solo le ultime 100 operazioni
    if (pluginData.operations.length > 100) {
      pluginData.operations = pluginData.operations.slice(-100);
    }
  }

  // Statistiche per plugin
  getPluginStats(pluginId) {
    const pluginData = this.pluginStreams.get(pluginId);
    if (!pluginData) {
      return {
        operations: 0,
        lastActivity: null,
        uptime: 0
      };
    }
    
    const now = Date.now();
    const uptime = now - pluginData.lastActivity;
    
    return {
      operations: pluginData.operations.length,
      lastActivity: new Date(pluginData.lastActivity).toISOString(),
      uptime: Math.floor(uptime / 1000), // secondi
      recentOperations: pluginData.operations.slice(-10) // ultime 10 operazioni
    };
  }

  // Statistiche globali
  getGlobalStats() {
    const stats = {
      ytdlp: this.ytdlpService.healthCheck(),
      proxy: this.proxyService.healthCheck(),
      plugins: {},
      timestamp: new Date().toISOString()
    };
    
    // Statistiche per ogni plugin
    for (const [pluginId, pluginData] of this.pluginStreams.entries()) {
      stats.plugins[pluginId] = this.getPluginStats(pluginId);
    }
    
    return stats;
  }

  // Health check completo
  async healthCheck() {
    try {
      const ytdlpHealth = await this.ytdlpService.healthCheck();
      const proxyHealth = await this.proxyService.healthCheck();
      
      const overallStatus = 
        ytdlpHealth.status === 'healthy' && 
        proxyHealth.status === 'healthy' ? 'healthy' : 'degraded';
      
      return {
        status: overallStatus,
        services: {
          ytdlp: ytdlpHealth,
          proxy: proxyHealth
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

  // Combine video and audio streams
  async combineStreams(pluginId, videoId, videoFormatId, audioFormatId, req, res) {
    try {
      console.log(`🎬 Combining streams: ${videoId} (video: ${videoFormatId}, audio: ${audioFormatId})`);
      
      // Get video info to access the format URLs
      const videoInfo = await this.ytdlpService.getVideoInfo(videoId);
      
      if (!videoInfo || !videoInfo.requested_formats) {
        throw new Error('Video info or requested formats not available');
      }
      
      // Find the specific video and audio formats
      const videoFormat = videoInfo.requested_formats.find(f => f.format_id === videoFormatId);
      const audioFormat = videoInfo.requested_formats.find(f => f.format_id === audioFormatId);
      
      if (!videoFormat || !audioFormat) {
        throw new Error('Video or audio format not found');
      }
      
      // Create a combined stream using ffmpeg or similar
      // For now, we'll redirect to the video format and let the client handle audio separately
      // In a full implementation, you would use ffmpeg to merge the streams
      
      console.log(`✅ Stream combination prepared for ${videoId}`);
      
      // Redirect to the video stream (client can handle audio separately)
      res.redirect(videoFormat.url);
      
    } catch (error) {
      console.error('❌ Stream combine error:', error);
      res.status(500).json({ 
        error: 'Failed to combine streams', 
        details: error.message 
      });
    }
  }

  // Cleanup e shutdown
  async shutdown() {
    console.log('🛑 StreamingManager shutdown...');
    
    try {
      await this.ytdlpService.shutdown();
      await this.proxyService.shutdown();
      
      this.pluginStreams.clear();
      console.log('✅ StreamingManager shutdown completato');
      
    } catch (error) {
      console.error('❌ Errore durante shutdown StreamingManager:', error);
    }
  }
}

module.exports = StreamingManager;
