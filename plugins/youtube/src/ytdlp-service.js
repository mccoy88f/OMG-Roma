const { exec, spawn } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);

class YtDlpService {
  constructor(config) {
    this.config = config;
    this.available = false;
    this.version = null;
  }

  async checkAvailability() {
    try {
      const { stdout } = await execAsync('yt-dlp --version');
      this.version = stdout.trim();
      this.available = true;
      console.log(`✅ yt-dlp available - Version: ${this.version}`);
      return true;
    } catch (error) {
      console.error('❌ yt-dlp not available:', error.message);
      this.available = false;
      return false;
    }
  }

  isAvailable() {
    return this.available;
  }

  async search(query, options = {}) {
    if (!this.available) {
      throw new Error('yt-dlp is not available');
    }

    const { skip = 0, limit = 20 } = options;
    const adultContent = this.config.get('adult_content', false);

    try {
      console.log(`🔍 yt-dlp search: "${query}"`);

      // Build search command
      const searchQuery = `ytsearch${limit + skip}:${query}`;
      const cmd = [
        'yt-dlp',
        '--dump-json',
        '--no-download',
        '--ignore-errors',
        '--no-warnings',
        searchQuery
      ];

      // Add adult content filter if disabled
      if (!adultContent) {
        cmd.push('--match-filter', '!is_live & duration>30 & !adult');
      }

      const { stdout } = await execAsync(cmd.join(' '), {
        timeout: 60000, // 60 second timeout
        maxBuffer: 1024 * 1024 * 10 // 10MB buffer
      });

      const videos = this.parseYtDlpOutput(stdout);
      
      // Apply skip and limit
      const paginatedVideos = videos.slice(skip, skip + limit);
      const hasMore = videos.length > skip + limit;

      console.log(`✅ yt-dlp search completed: ${paginatedVideos.length} videos`);

      return {
        videos: paginatedVideos,
        hasMore
      };

    } catch (error) {
      console.error('❌ yt-dlp search failed:', error);
      throw new Error(`Search failed: ${error.message}`);
    }
  }

  async getChannelVideos(channelUrl, options = {}) {
    if (!this.available) {
      throw new Error('yt-dlp is not available');
    }

    const { limit = 20 } = options;

    try {
      console.log(`📺 Getting channel videos: ${channelUrl}`);

      const cmd = [
        'yt-dlp',
        '--dump-json',
        '--no-download',
        '--ignore-errors',
        '--no-warnings',
        '--playlist-end', limit.toString(),
        channelUrl
      ];

      const { stdout } = await execAsync(cmd.join(' '), {
        timeout: 120000, // 2 minute timeout for channels
        maxBuffer: 1024 * 1024 * 20 // 20MB buffer
      });

      const videos = this.parseYtDlpOutput(stdout);

      console.log(`✅ Channel videos retrieved: ${videos.length} videos`);

      return videos;

    } catch (error) {
      console.error('❌ Channel videos failed:', error);
      throw new Error(`Channel fetch failed: ${error.message}`);
    }
  }

  async getVideoInfo(videoId) {
    if (!this.available) {
      throw new Error('yt-dlp is not available');
    }

    try {
      console.log(`📝 Getting video info: ${videoId}`);

      const videoUrl = this.buildVideoUrl(videoId);
      
      const cmd = [
        'yt-dlp',
        '--dump-json',
        '--no-download',
        '--ignore-errors',
        '--no-warnings',
        videoUrl
      ];

      const { stdout } = await execAsync(cmd.join(' '), {
        timeout: 30000, // 30 second timeout
        maxBuffer: 1024 * 1024 * 5 // 5MB buffer
      });

      const videos = this.parseYtDlpOutput(stdout);
      
      if (videos.length === 0) {
        return null;
      }

      console.log(`✅ Video info retrieved: ${videos[0].title}`);

      return videos[0];

    } catch (error) {
      console.error('❌ Video info failed:', error);
      throw new Error(`Video info failed: ${error.message}`);
    }
  }

  async getVideoStreams(videoId) {
    if (!this.available) {
      throw new Error('yt-dlp is not available');
    }

    try {
      console.log(`🎬 Getting video streams: ${videoId}`);

      const videoUrl = this.buildVideoUrl(videoId);
      
      // Get video formats using yt-dlp
      const cmd = [
        'yt-dlp',
        '--get-url',
        '--format', 'bestvideo+bestaudio/best',
        '--no-warnings',
        videoUrl
      ];

      const { stdout } = await execAsync(cmd.join(' '), {
        timeout: 45000, // 45 second timeout
        maxBuffer: 1024 * 1024 * 2 // 2MB buffer
      });

      const urls = stdout.trim().split('\n').filter(url => url.length > 0);
      
      if (urls.length === 0) {
        console.warn(`⚠️  No streams found for: ${videoId}`);
        return [];
      }

      // Get video info for metadata
      const videoInfo = await this.getVideoInfo(videoId);
      if (!videoInfo) {
        throw new Error('Could not get video metadata');
      }

      // Build stream objects
      const streams = await this.buildStreamObjects(urls, videoInfo);

      console.log(`✅ Built ${streams.length} streams for: ${videoId}`);

      return streams;

    } catch (error) {
      console.error('❌ Video streams failed:', error);
      throw new Error(`Stream extraction failed: ${error.message}`);
    }
  }

  async buildStreamObjects(urls, videoInfo) {
    const streams = [];
    
    // Primary stream with best quality
    if (urls.length > 0) {
      streams.push({
        name: `🎥 YouTube - Best Quality`,
        title: videoInfo.title,
        url: urls[0],
        quality: this.detectQuality(videoInfo),
        format: 'MP4/WebM',
        behaviorHints: {
          bingeGroup: `youtube-${videoInfo.channel || 'unknown'}`,
          notWebReady: false
        }
      });
    }

    // Additional streams if available (fallbacks)
    if (urls.length > 1) {
      for (let i = 1; i < Math.min(urls.length, 3); i++) {
        streams.push({
          name: `🎥 YouTube - Stream ${i + 1}`,
          title: videoInfo.title,
          url: urls[i],
          quality: 'Auto',
          format: 'MP4/WebM',
          behaviorHints: {
            bingeGroup: `youtube-${videoInfo.channel || 'unknown'}`,
            notWebReady: false
          }
        });
      }
    }

    return streams;
  }

  parseYtDlpOutput(stdout) {
    const videos = [];
    const lines = stdout.trim().split('\n');

    for (const line of lines) {
      if (!line.trim()) continue;

      try {
        const data = JSON.parse(line);
        
        // Skip live streams and very short videos
        if (data.is_live || (data.duration && data.duration < 10)) {
          continue;
        }

        const video = {
          id: data.id,
          title: data.title || 'Unknown Title',
          description: data.description || '',
          duration: this.formatDuration(data.duration),
          thumbnail: data.thumbnail || data.thumbnails?.[0]?.url || '',
          url: data.webpage_url || `https://www.youtube.com/watch?v=${data.id}`,
          channel: data.uploader || data.channel || 'Unknown Channel',
          publishedAt: data.upload_date ? this.parseUploadDate(data.upload_date) : new Date().toISOString(),
          viewCount: data.view_count || 0,
          rating: this.calculateRating(data),
          tags: data.tags || [],
          adult: this.detectAdultContent(data)
        };

        videos.push(video);

      } catch (error) {
        console.warn('⚠️  Failed to parse yt-dlp line:', error.message);
        continue;
      }
    }

    return videos;
  }

  buildVideoUrl(videoId) {
    // Handle different ID formats
    if (videoId.startsWith('http')) {
      return videoId;
    }
    
    return `https://www.youtube.com/watch?v=${videoId}`;
  }

  detectQuality(videoInfo) {
    if (!videoInfo.height) return 'Auto';
    
    const height = videoInfo.height;
    
    if (height >= 2160) return '4K';
    if (height >= 1440) return '1440p';
    if (height >= 1080) return '1080p';
    if (height >= 720) return '720p';
    if (height >= 480) return '480p';
    return '360p';
  }

  formatDuration(seconds) {
    if (!seconds) return '';
    
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    
    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
  }

  parseUploadDate(uploadDate) {
    // uploadDate format: YYYYMMDD
    if (!uploadDate || uploadDate.length !== 8) {
      return new Date().toISOString();
    }
    
    const year = uploadDate.substring(0, 4);
    const month = uploadDate.substring(4, 6);
    const day = uploadDate.substring(6, 8);
    
    return new Date(`${year}-${month}-${day}`).toISOString();
  }

  calculateRating(data) {
    // Calculate a rating based on views, likes, and other metrics
    const viewCount = data.view_count || 0;
    const likeCount = data.like_count || 0;
    
    if (viewCount === 0) return 0;
    
    const likeRatio = likeCount / viewCount;
    const viewScore = Math.min(10, Math.log10(viewCount + 1));
    const likeScore = Math.min(10, likeRatio * 1000);
    
    return Math.round((viewScore + likeScore) / 2 * 10) / 10;
  }

  detectAdultContent(data) {
    // Simple adult content detection
    const adultKeywords = ['adult', 'nsfw', 'explicit', '18+', 'mature'];
    const title = (data.title || '').toLowerCase();
    const description = (data.description || '').toLowerCase();
    const tags = (data.tags || []).join(' ').toLowerCase();
    
    const content = `${title} ${description} ${tags}`;
    
    return adultKeywords.some(keyword => content.includes(keyword));
  }
}

module.exports = YtDlpService;