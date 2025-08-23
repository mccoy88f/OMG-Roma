const { spawn } = require('child_process');
const fs = require('fs-extra');
const path = require('path');

class YtdlpService {
  constructor() {
    this.cacheDir = path.join(__dirname, '../cache/ytdlp');
    this.cache = new Map();
    this.cacheTimeout = 5 * 60 * 1000; // 5 minuti
    this.maxCacheSize = 1000; // Max 1000 elementi in cache
    
    this.ensureCacheDir();
    this.startCleanupInterval();
  }

  async ensureCacheDir() {
    try {
      await fs.ensureDir(this.cacheDir);
      console.log('📁 Cache directory yt-dlp creata:', this.cacheDir);
    } catch (error) {
      console.error('❌ Errore creazione cache directory:', error);
    }
  }

  startCleanupInterval() {
    // Pulisce la cache ogni 10 minuti
    setInterval(() => {
      this.cleanupCache();
    }, 10 * 60 * 1000);
  }

  cleanupCache() {
    const now = Date.now();
    let cleaned = 0;
    
    for (const [key, value] of this.cache.entries()) {
      if (now - value.timestamp > this.cacheTimeout) {
        this.cache.delete(key);
        cleaned++;
      }
    }
    
    if (cleaned > 0) {
      console.log(`🧹 Cache yt-dlp pulita: ${cleaned} elementi rimossi`);
    }
  }

  async checkYtdlpAvailability() {
    try {
      const version = await this.runYtdlp(['--version']);
      console.log(`✅ yt-dlp disponibile - Versione: ${version.trim()}`);
      return true;
    } catch (error) {
      console.error('❌ yt-dlp non disponibile:', error.message);
      return false;
    }
  }

  async runYtdlp(args, options = {}) {
    return new Promise((resolve, reject) => {
      const ytdlp = spawn('yt-dlp', args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        ...options
      });

      let stdout = '';
      let stderr = '';

      ytdlp.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      ytdlp.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      ytdlp.on('close', (code) => {
        if (code === 0) {
          resolve(stdout);
        } else {
          reject(new Error(`yt-dlp exited with code ${code}: ${stderr}`));
        }
      });

      ytdlp.on('error', (error) => {
        reject(new Error(`Failed to start yt-dlp: ${error.message}`));
      });

      // Timeout di sicurezza
      setTimeout(() => {
        ytdlp.kill();
        reject(new Error('yt-dlp timeout'));
      }, options.timeout || 30000);
    });
  }

  generateCacheKey(operation, params) {
    return `${operation}_${JSON.stringify(params)}`;
  }

  getFromCache(key) {
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
      return cached.data;
    }
    return null;
  }

  setCache(key, data) {
    // Gestione dimensione cache
    if (this.cache.size >= this.maxCacheSize) {
      const oldestKey = this.cache.keys().next().value;
      this.cache.delete(oldestKey);
    }
    
    this.cache.set(key, {
      data,
      timestamp: Date.now()
    });
  }

  // Ricerca video
  async searchVideos(query, options = {}) {
    const {
      limit = 20,
      skip = 0,
      searchType = 'video',
      dateFilter = 'all',
      durationFilter = 'all'
    } = options;

    const cacheKey = this.generateCacheKey('search', { query, limit, searchType, dateFilter, durationFilter });
    const cached = this.getFromCache(cacheKey);
    
    if (cached) {
      console.log(`📋 Cache hit per ricerca: ${query}`);
      return this.applyPagination(cached, skip, limit);
    }

    try {
      console.log(`🔍 yt-dlp search: "${query}" (skip: ${skip}, limit: ${limit})`);
      
      const args = [
        'ytsearch' + limit + ':' + query,
        '--dump-json',
        '--no-playlist',
        '--extract-audio',
        '--audio-format', 'mp3',
        '--audio-quality', '0'
      ];

      // Filtri per data
      if (dateFilter === 'year') {
        args.push('--date-after', '1 year ago');
      } else if (dateFilter === 'month') {
        args.push('--date-after', '1 month ago');
      } else if (dateFilter === 'week') {
        args.push('--date-after', '1 week ago');
      }

      // Filtri per durata
      if (durationFilter === 'short') {
        args.push('--max-duration', '600'); // Max 10 minuti
      } else if (durationFilter === 'medium') {
        args.push('--min-duration', '600', '--max-duration', '3600'); // 10 min - 1 ora
      } else if (durationFilter === 'long') {
        args.push('--min-duration', '3600'); // Min 1 ora
      }

      const output = await this.runYtdlp(args, { timeout: 45000 });
      const videos = this.parseYtdlpOutput(output);
      
      // Salva in cache
      this.setCache(cacheKey, videos);
      
      console.log(`✅ Ricerca completata: ${videos.length} video trovati`);
      
      return this.applyPagination(videos, skip, limit);
      
    } catch (error) {
      console.error('❌ Errore ricerca yt-dlp:', error);
      throw new Error(`Ricerca fallita: ${error.message}`);
    }
  }

  // Ottieni info video
  async getVideoInfo(videoId) {
    const cacheKey = this.generateCacheKey('info', { videoId });
    const cached = this.getFromCache(cacheKey);
    
    if (cached) {
      return cached;
    }

    try {
      console.log(`📝 yt-dlp info per: ${videoId}`);
      
      const args = [
        '--dump-json',
        '--no-playlist',
        videoId
      ];

      const output = await this.runYtdlp(args, { timeout: 30000 });
      const videoInfo = JSON.parse(output);
      
      // Normalizza i dati per Stremio
      const normalizedInfo = this.normalizeVideoInfo(videoInfo);
      
      // Salva in cache
      this.setCache(cacheKey, normalizedInfo);
      
      return normalizedInfo;
      
    } catch (error) {
      console.error('❌ Errore info video yt-dlp:', error);
      throw new Error(`Impossibile ottenere info video: ${error.message}`);
    }
  }

  // Ottieni formati disponibili con bestvideo+bestaudio
  async getVideoFormats(videoId) {
    const cacheKey = this.generateCacheKey('formats', { videoId });
    const cached = this.getFromCache(cacheKey);
    
    if (cached) {
      return cached;
    }

    try {
      console.log(`🎬 yt-dlp formats per: ${videoId} (bestvideo+bestaudio)`);
      
      const args = [
        '--dump-json',
        '--no-playlist',
        '-f', 'bestvideo+bestaudio/best',
        videoId
      ];

      const output = await this.runYtdlp(args, { timeout: 30000 });
      const videoInfo = JSON.parse(output);
      
      // Estrai sia il formato migliore combinato che i formati separati
      const formats = this.extractOptimalFormats(videoInfo);
      
      // Salva in cache
      this.setCache(cacheKey, formats);
      
      return formats;
      
    } catch (error) {
      console.error('❌ Errore formats video yt-dlp:', error);
      throw new Error(`Impossibile ottenere formats: ${error.message}`);
    }
  }

  // Ottieni URL streaming diretti per bestvideo+bestaudio
  async getBestStreamUrls(videoId) {
    const cacheKey = this.generateCacheKey('stream_urls', { videoId });
    const cached = this.getFromCache(cacheKey);
    
    if (cached) {
      return cached;
    }

    try {
      console.log(`🔗 yt-dlp stream URLs per: ${videoId} (bestvideo+bestaudio)`);
      
      // Ottieni URL per bestvideo
      const videoArgs = [
        '--get-url',
        '--no-playlist',
        '-f', 'bestvideo',
        videoId
      ];

      // Ottieni URL per bestaudio  
      const audioArgs = [
        '--get-url',
        '--no-playlist',
        '-f', 'bestaudio',
        videoId
      ];

      const [videoUrl, audioUrl] = await Promise.all([
        this.runYtdlp(videoArgs, { timeout: 30000 }),
        this.runYtdlp(audioArgs, { timeout: 30000 })
      ]);

      const streamUrls = {
        bestVideo: videoUrl.trim(),
        bestAudio: audioUrl.trim(),
        combined: null // Sarà gestito dal proxy se necessario
      };

      // Salva in cache
      this.setCache(cacheKey, streamUrls);
      
      console.log(`✅ Stream URLs ottenuti per: ${videoId}`);
      return streamUrls;
      
    } catch (error) {
      console.error('❌ Errore stream URLs yt-dlp:', error);
      throw new Error(`Impossibile ottenere stream URLs: ${error.message}`);
    }
  }

  // Ottieni video da canale
  async getChannelVideos(channelUrl, options = {}) {
    const { limit = 20 } = options;
    
    const cacheKey = this.generateCacheKey('channel', { channelUrl, limit });
    const cached = this.getFromCache(cacheKey);
    
    if (cached) {
      return cached;
    }

    try {
      console.log(`📺 yt-dlp channel videos da: ${channelUrl}`);
      
      const args = [
        '--dump-json',
        '--extract-audio',
        '--audio-format', 'mp3',
        '--audio-quality', '0',
        '--playlist-items', `1-${limit}`,
        channelUrl
      ];

      const output = await this.runYtdlp(args, { timeout: 60000 });
      const videos = this.parseYtdlpOutput(output);
      
      // Salva in cache
      this.setCache(cacheKey, videos);
      
      console.log(`✅ Channel videos: ${videos.length} trovati`);
      
      return videos;
      
    } catch (error) {
      console.error('❌ Errore channel videos yt-dlp:', error);
      throw new Error(`Impossibile ottenere video canale: ${error.message}`);
    }
  }

  // Utility methods
  parseYtdlpOutput(output) {
    try {
      const lines = output.trim().split('\n');
      const videos = [];
      
      for (const line of lines) {
        if (line.trim()) {
          try {
            const video = JSON.parse(line);
            videos.push(this.normalizeVideoInfo(video));
          } catch (parseError) {
            console.warn('⚠️ Errore parsing linea yt-dlp:', parseError.message);
          }
        }
      }
      
      return videos;
    } catch (error) {
      console.error('❌ Errore parsing output yt-dlp:', error);
      return [];
    }
  }

  normalizeVideoInfo(video) {
    return {
      id: video.id || video.url,
      title: video.title || 'Unknown Title',
      description: video.description || '',
      duration: video.duration || 0,
      viewCount: video.view_count || 0,
      likeCount: video.like_count || 0,
      publishedAt: video.upload_date ? this.formatUploadDate(video.upload_date) : new Date().toISOString(),
      channel: video.channel || video.uploader || 'Unknown Channel',
      channelUrl: video.channel_url || video.uploader_url || '',
      thumbnail: video.thumbnail || '',
      tags: video.tags || [],
      categories: video.categories || [],
      language: video.language || 'en',
      ageLimit: video.age_limit || 0,
      isLive: video.is_live || false,
      liveStatus: video.live_status || 'not_live'
    };
  }

  formatUploadDate(uploadDate) {
    // Converti YYYYMMDD in ISO string
    if (uploadDate && uploadDate.length === 8) {
      const year = uploadDate.substring(0, 4);
      const month = uploadDate.substring(4, 6);
      const day = uploadDate.substring(6, 8);
      return new Date(year, month - 1, day).toISOString();
    }
    return new Date().toISOString();
  }

  extractFormats(videoInfo) {
    const formats = [];
    
    if (videoInfo.formats) {
      for (const format of videoInfo.formats) {
        if (format.url && format.ext) {
          formats.push({
            url: format.url,
            ext: format.ext,
            quality: format.quality || 'unknown',
            width: format.width || 0,
            height: format.height || 0,
            fps: format.fps || 0,
            filesize: format.filesize || 0,
            vcodec: format.vcodec || 'none',
            acodec: format.acodec || 'none'
          });
        }
      }
    }
    
    // Ordina per qualità (migliore prima)
    formats.sort((a, b) => {
      const qualityA = this.getQualityScore(a);
      const qualityB = this.getQualityScore(b);
      return qualityB - qualityA;
    });
    
    return formats;
  }

  // Estrai formati ottimali con bestvideo+bestaudio
  extractOptimalFormats(videoInfo) {
    const formats = [];
    
    // Se il video ha format_id, significa che è il risultato di bestvideo+bestaudio
    if (videoInfo.format_id && videoInfo.url) {
      formats.push({
        url: videoInfo.url,
        ext: videoInfo.ext || 'mp4',
        quality: 'best',
        width: videoInfo.width || 0,
        height: videoInfo.height || 0,
        fps: videoInfo.fps || 30,
        filesize: videoInfo.filesize || 0,
        vcodec: videoInfo.vcodec || 'unknown',
        acodec: videoInfo.acodec || 'unknown',
        format_id: videoInfo.format_id,
        label: `🎬 Best Quality (${videoInfo.height || 'Unknown'}p)`,
        type: 'combined',
        video_title: videoInfo.title || 'Unknown Video',
        channel_name: videoInfo.channel || videoInfo.uploader || 'Unknown Author'
      });
    }
    
    // Se abbiamo requested_formats, sono i formati separati di bestvideo+bestaudio
    if (videoInfo.requested_formats && Array.isArray(videoInfo.requested_formats)) {
      // Cerca di creare formati combinati quando possibile
      const videoFormats = videoInfo.requested_formats.filter(f => f.vcodec && f.vcodec !== 'none');
      const audioFormats = videoInfo.requested_formats.filter(f => f.acodec && f.acodec !== 'none');
      
      // Crea formati combinati per le migliori qualità
      if (videoFormats.length > 0 && audioFormats.length > 0) {
        // Prendi il miglior video e il miglior audio
        const bestVideo = videoFormats.reduce((best, current) => 
          (current.height || 0) > (best.height || 0) ? current : best
        );
        const bestAudio = audioFormats.reduce((best, current) => 
          (current.abr || 0) > (best.abr || 0) ? current : best
        );
        
        // Crea formato combinato usando il proxy del gateway
        const gatewayUrl = process.env.GATEWAY_URL || 'http://gateway:3100';
        const combinedUrl = `${gatewayUrl}/api/streaming/youtube/combine/${videoInfo.id}?video=${bestVideo.format_id}&audio=${bestAudio.format_id}`;
        
        formats.push({
          url: combinedUrl,
          ext: bestVideo.ext || 'mp4',
          quality: `${bestVideo.height}p`,
          width: bestVideo.width || 0,
          height: bestVideo.height || 0,
          fps: bestVideo.fps || 30,
          filesize: (bestVideo.filesize || 0) + (bestAudio.filesize || 0),
          vcodec: bestVideo.vcodec || 'unknown',
          acodec: bestAudio.acodec || 'unknown',
          format_id: `${bestVideo.format_id}+${bestAudio.format_id}`,
          label: `🎬 Combined Best (${bestVideo.height || 'Unknown'}p)`,
          type: 'combined',
          video_title: videoInfo.title || 'Unknown Video',
          channel_name: videoInfo.channel || videoInfo.uploader || 'Unknown Author'
        });
      }
      
      // Aggiungi anche i formati separati come fallback
      videoFormats.forEach(format => {
        formats.push({
          url: format.url,
          ext: format.ext || 'mp4',
          quality: `${format.height}p`,
          width: format.width || 0,
          height: format.height || 0,
          fps: format.fps || 0,
          filesize: format.filesize || 0,
          vcodec: format.vcodec || 'none',
          acodec: 'none',
          format_id: format.format_id,
          label: `🎬 Video Only (${format.height || 'Unknown'}p)`,
          type: 'video',
          video_title: videoInfo.title || 'Unknown Video',
          channel_name: videoInfo.channel || videoInfo.uploader || 'Unknown Author'
        });
      });
      
      audioFormats.forEach(format => {
        formats.push({
          url: format.url,
          ext: format.ext || 'mp4',
          quality: 'audio',
          width: 0,
          height: 0,
          fps: 0,
          filesize: format.filesize || 0,
          vcodec: 'none',
          acodec: format.acodec || 'none',
          format_id: format.format_id,
          label: `🎵 Audio Only`,
          type: 'audio',
          video_title: videoInfo.title || 'Unknown Video',
          channel_name: videoInfo.channel || videoInfo.uploader || 'Unknown Author'
        });
      });
    }
    
    // Fallback: se non abbiamo formati, usa il metodo standard
    if (formats.length === 0) {
      return this.extractFormats(videoInfo);
    }
    
    return formats;
  }

  getQualityScore(format) {
    let score = 0;
    
    // Punteggio per risoluzione
    if (format.height >= 2160) score += 1000; // 4K
    else if (format.height >= 1440) score += 800; // 1440p
    else if (format.height >= 1080) score += 600; // 1080p
    else if (format.height >= 720) score += 400; // 720p
    else if (format.height >= 480) score += 200; // 480p
    else score += 100; // 360p e inferiori
    
    // Bonus per FPS alto
    if (format.fps >= 60) score += 100;
    else if (format.fps >= 30) score += 50;
    
    // Bonus per codec moderni
    if (format.vcodec && format.vcodec.includes('avc1')) score += 50;
    if (format.acodec && format.acodec.includes('mp4a')) score += 25;
    
    return score;
  }

  applyPagination(videos, skip, limit) {
    const start = skip;
    const end = start + limit;
    const paginated = videos.slice(start, end);
    const hasMore = videos.length > end;
    
    return {
      videos: paginated,
      hasMore,
      total: videos.length,
      skip,
      limit
    };
  }

  // Health check
  async healthCheck() {
    try {
      const isAvailable = await this.checkYtdlpAvailability();
      const cacheSize = this.cache.size;
      const cacheHitRate = this.getCacheHitRate();
      
      return {
        status: isAvailable ? 'healthy' : 'unhealthy',
        ytdlp: isAvailable,
        cache: {
          size: cacheSize,
          hitRate: cacheHitRate,
          maxSize: this.maxCacheSize
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

  getCacheHitRate() {
    // Implementazione semplificata - in produzione usare metriche reali
    return 0.75; // 75% hit rate stimato
  }

  // Cleanup
  async shutdown() {
    console.log('🛑 YtdlpService shutdown...');
    this.cache.clear();
  }
}

module.exports = YtdlpService;
