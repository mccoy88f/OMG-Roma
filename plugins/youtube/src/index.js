const express = require('express');
const fs = require('fs-extra');
const path = require('path');

const YouTubeAPI = require('./youtube-api');
const ConfigManager = require('./config-manager');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(express.json());

// Initialize services
let config;
let youtubeAPI;

async function initializeServices() {
  try {
    console.log('🎥 Initializing OMG-Roma YouTube Plugin...');
    
    // Load configuration
    config = new ConfigManager(process.env.CONFIG_FILE || '/app/config.json');
    await config.load();
    
    // Initialize YouTube API
    youtubeAPI = new YouTubeAPI(config.get('api_key'));
    
    // yt-dlp service is now centralized in the gateway
    console.log('ℹ️  yt-dlp service is centralized in OMG-Roma Gateway');
    
    console.log('✅ OMG-Roma YouTube Plugin initialized successfully');
    
  } catch (error) {
    console.error('❌ Failed to initialize OMG-Roma YouTube Plugin:', error);
    throw error;
  }
}

// Plugin info endpoint
app.get('/plugin.json', (req, res) => {
  try {
    console.log('📄 Plugin info endpoint called');
    console.log('🔍 Current working directory:', process.cwd());
    console.log('📁 Files in current directory:', require('fs').readdirSync('.'));
    
    const pluginInfo = require('../plugin.json');
    console.log('✅ Plugin info loaded successfully:', pluginInfo.id, pluginInfo.name);
    res.json(pluginInfo);
  } catch (error) {
    console.error('❌ Error loading plugin.json:', error);
    console.error('📁 Available files:', require('fs').readdirSync('.'));
    res.status(404).json({ error: 'Plugin info not found', details: error.message });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    plugin: 'youtube',
    version: '1.0.0',
    services: {
      youtube_api: youtubeAPI ? youtubeAPI.isConfigured() : false,
      ytdlp: 'centralized'
    }
  });
});

// Readiness check endpoint (more comprehensive than health)
app.get('/ready', (req, res) => {
  try {
    // Check if all services are properly initialized
    const isReady = youtubeAPI && youtubeAPI.isConfigured();
    
    if (isReady) {
      res.json({
        status: 'ready',
        timestamp: new Date().toISOString(),
        plugin: 'youtube',
        version: '1.0.0',
        services: {
          youtube_api: youtubeAPI.isConfigured(),
          ytdlp: 'centralized'
        }
      });
    } else {
      res.status(503).json({
        status: 'not_ready',
        timestamp: new Date().toISOString(),
        plugin: 'youtube',
        reason: 'Services not fully initialized'
      });
    }
  } catch (error) {
    res.status(503).json({
      status: 'error',
      timestamp: new Date().toISOString(),
      plugin: 'youtube',
      error: error.message
    });
  }
});

// Search endpoint
app.post('/search', async (req, res) => {
  try {
    const { search, skip = 0, limit = 20 } = req.body;
    
    console.log(`🔍 YouTube search: "${search}" (skip: ${skip}, limit: ${limit})`);
    
    if (!search || search.trim().length === 0) {
      return res.json({ videos: [], hasMore: false });
    }
    
    const searchMode = config.get('search_mode', 'hybrid');
    let videos = [];
    let hasMore = false;
    
    // Try API search first if available and mode allows
    if ((searchMode === 'api' || searchMode === 'hybrid') && youtubeAPI.isConfigured()) {
      try {
        console.log('🚀 Using YouTube API search');
        const result = await youtubeAPI.search(search, { skip, limit });
        videos = result.videos;
        hasMore = result.hasMore;
      } catch (error) {
        console.warn('⚠️  YouTube API search failed:', error.message);
        
        if (searchMode === 'api') {
          throw error; // If API-only mode, propagate error
        }
        // In hybrid mode, continue to yt-dlp fallback
      }
    }
    
    // Fallback to yt-dlp search if no results or hybrid/ytdlp mode
    if (videos.length === 0 && (searchMode === 'ytdlp' || searchMode === 'hybrid')) {
      console.log('🔄 Falling back to yt-dlp search');
      
      try {
        // Use yt-dlp directly for search (not through gateway)
        const { spawn } = require('child_process');
        const ytdlpArgs = [
          '--dump-json',
          '--extract-flat',
          '--playlist-items', '1-20',
          'ytsearch:' + search
        ];
        
        const ytdlpProcess = spawn('yt-dlp', ytdlpArgs);
        let output = '';
        
        ytdlpProcess.stdout.on('data', (data) => {
          output += data.toString();
        });
        
        ytdlpProcess.stderr.on('data', (data) => {
          console.warn('yt-dlp stderr:', data.toString());
        });
        
        await new Promise((resolve, reject) => {
          ytdlpProcess.on('close', (code) => {
            if (code === 0) resolve();
            else reject(new Error(`yt-dlp exited with code ${code}`));
          });
        });
        
        // Parse yt-dlp output
        const lines = output.trim().split('\n').filter(line => line.trim());
        const ytdlpVideos = lines.map(line => {
          try {
            const video = JSON.parse(line);
            return {
              id: video.id,
              title: video.title,
              thumbnail: video.thumbnail,
              duration: video.duration,
              publishedAt: video.upload_date,
              viewCount: video.view_count,
              channelTitle: video.channel
            };
          } catch (e) {
            return null;
          }
        }).filter(v => v);
        
        videos = ytdlpVideos;
        hasMore = ytdlpVideos.length >= limit;
        console.log(`✅ yt-dlp search found ${videos.length} videos`);
        
      } catch (error) {
        console.warn('⚠️  yt-dlp search error:', error.message);
      }
    }
    
    console.log(`✅ Found ${videos.length} videos`);
    
    res.json({ videos, hasMore });
    
  } catch (error) {
    console.error('❌ Search error:', error);
    res.status(500).json({ 
      error: 'Search failed', 
      details: error.message,
      videos: [],
      hasMore: false
    });
  }
});

// Discover endpoint
app.post('/discover', async (req, res) => {
  try {
    const { skip = 0, limit = 20 } = req.body;
    const followedChannels = config.get('followed_channels', []);
    
    console.log(`📺 YouTube discover (skip: ${skip}, limit: ${limit})`);
    console.log(`Following ${followedChannels.length} channels`);
    
    if (followedChannels.length === 0) {
      return res.json({ 
        videos: [], 
        hasMore: false,
        message: 'No followed channels configured'
      });
    }
    
    let allVideos = [];
    
    // Get videos from all followed channels
    for (const channelUrl of followedChannels) {
      try {
        console.log(`📡 Fetching videos from: ${channelUrl}`);
        
        // Get channel videos using yt-dlp directly
        const { spawn } = require('child_process');
        const ytdlpArgs = [
          '--dump-json',
          '--extract-flat',
          '--playlist-items', `1-${Math.ceil(limit / followedChannels.length)}`,
          channelUrl
        ];
        
        const ytdlpProcess = spawn('yt-dlp', ytdlpArgs);
        let output = '';
        
        ytdlpProcess.stdout.on('data', (data) => {
          output += data.toString();
        });
        
        ytdlpProcess.stderr.on('data', (data) => {
          console.warn('yt-dlp stderr:', data.toString());
        });
        
        await new Promise((resolve, reject) => {
          ytdlpProcess.on('close', (code) => {
            if (code === 0) resolve();
            else reject(new Error(`yt-dlp exited with code ${code}`));
          });
        });
        
        // Parse yt-dlp output
        const lines = output.trim().split('\n').filter(line => line.trim());
        channelVideos = lines.map(line => {
          try {
            const video = JSON.parse(line);
            return {
              id: video.id,
              title: video.title,
              thumbnail: video.thumbnail,
              duration: video.duration,
              publishedAt: video.upload_date,
              viewCount: video.view_count,
              channelTitle: video.channel
            };
          } catch (e) {
            return null;
          }
        }).filter(v => v);
        
        console.log(`✅ Found ${channelVideos.length} videos from ${channelUrl}`);
        
        allVideos.push(...channelVideos);
        
      } catch (error) {
        console.warn(`⚠️  Failed to fetch from ${channelUrl}:`, error.message);
      }
    }
    
    // Sort by publish date (newest first)
    allVideos.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
    
    // Apply pagination
    const paginatedVideos = allVideos.slice(skip, skip + limit);
    const hasMore = allVideos.length > skip + limit;
    
    console.log(`✅ Discover found ${paginatedVideos.length} videos`);
    
    res.json({ 
      videos: paginatedVideos, 
      hasMore 
    });
    
  } catch (error) {
    console.error('❌ Discover error:', error);
    res.status(500).json({ 
      error: 'Discover failed', 
      details: error.message,
      videos: [],
      hasMore: false
    });
  }
});

// Meta endpoint
app.post('/meta', async (req, res) => {
  try {
    const { videoId } = req.body;
    
    console.log(`📝 Getting meta for: ${videoId}`);
    
    // Get video metadata using yt-dlp directly
    const { spawn } = require('child_process');
    const ytdlpArgs = [
      '--dump-json',
      '--no-playlist',
      `https://www.youtube.com/watch?v=${videoId}`
    ];
    
    const ytdlpProcess = spawn('yt-dlp', ytdlpArgs);
    let output = '';
    
    ytdlpProcess.stdout.on('data', (data) => {
      output += data.toString();
    });
    
    ytdlpProcess.stderr.on('data', (data) => {
      console.warn('yt-dlp stderr:', data.toString());
    });
    
    await new Promise((resolve, reject) => {
      ytdlpProcess.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`yt-dlp exited with code ${code}`));
      });
    });
    
    // Parse yt-dlp output
    const videoData = JSON.parse(output.trim());
    video = {
      id: videoData.id,
      title: videoData.title,
      description: videoData.description,
      thumbnail: videoData.thumbnail,
      duration: videoData.duration,
      publishedAt: videoData.upload_date,
      viewCount: videoData.view_count,
      channelTitle: videoData.channel,
      tags: videoData.tags || []
    };
    
    console.log(`✅ Meta retrieved for: ${video.title}`);
    res.json({ video });
    
  } catch (error) {
    console.error('❌ Meta error:', error);
    res.status(500).json({ 
      error: 'Failed to get video metadata', 
      details: error.message 
    });
  }
});

// Stream endpoint
app.post('/stream', async (req, res) => {
  try {
    const { videoId } = req.body;
    
    console.log(`🎬 Getting streams for: ${videoId}`);
    
    // Get video streams using yt-dlp directly
    const { spawn } = require('child_process');
    const ytdlpArgs = [
      '--dump-json',
      '--no-playlist',
      `https://www.youtube.com/watch?v=${videoId}`
    ];
    
    const ytdlpProcess = spawn('yt-dlp', ytdlpArgs);
    let output = '';
    
    ytdlpProcess.stdout.on('data', (data) => {
      output += data.toString();
    });
    
    ytdlpProcess.stderr.on('data', (data) => {
      console.warn('yt-dlp stderr:', data.toString());
    });
    
    await new Promise((resolve, reject) => {
      ytdlpProcess.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`yt-dlp exited with code ${code}`));
      });
    });
    
    // Parse yt-dlp output and extract formats
    const videoData = JSON.parse(output.trim());
    streams = (videoData.formats || []).map(format => ({
      url: format.url,
      quality: format.quality || 'unknown',
      width: format.width,
      height: format.height,
      fps: format.fps,
      filesize: format.filesize,
      ext: format.ext
    })).filter(format => format.url);
    
    console.log(`✅ Found ${streams.length} streams for: ${videoId}`);
    res.json({ streams });
    
  } catch (error) {
    console.error('❌ Stream error:', error);
    res.status(500).json({ 
      error: 'Failed to get video streams', 
      details: error.message,
      streams: []
    });
  }
});

// Configuration endpoints
app.get('/config', (req, res) => {
  res.json(config.getAll());
});

// Integration endpoints for centralized services
app.get('/streaming/search', async (req, res) => {
  try {
    const { query, limit = 20, skip = 0, searchType, dateFilter, durationFilter } = req.query;
    
    console.log(`🔍 Centralized search request: "${query}"`);
    
    // Forward request to gateway streaming service
    const gatewayUrl = process.env.GATEWAY_URL || 'http://gateway:3100';
    const response = await fetch(`${gatewayUrl}/api/streaming/youtube/search?${new URLSearchParams(req.query)}`);
    
    if (response.ok) {
      const data = await response.json();
      res.json(data);
    } else {
      throw new Error(`Gateway error: ${response.status}`);
    }
    
  } catch (error) {
    console.error('❌ Centralized search error:', error);
    res.status(500).json({ 
      error: 'Centralized search failed', 
      details: error.message 
    });
  }
});

app.get('/streaming/info/:videoId', async (req, res) => {
  try {
    const { videoId } = req.params;
    
    console.log(`📝 Centralized info request for: ${videoId}`);
    
    // Forward request to gateway streaming service
    const gatewayUrl = process.env.GATEWAY_URL || 'http://gateway:3100';
    const response = await fetch(`${gatewayUrl}/api/streaming/youtube/info/${videoId}`);
    
    if (response.ok) {
      const data = await response.json();
      res.json(data);
    } else {
      throw new Error(`Gateway error: ${response.status}`);
    }
    
  } catch (error) {
    console.error('❌ Centralized info error:', error);
    res.status(500).json({ 
      error: 'Centralized info failed', 
      details: error.message 
    });
  }
});

app.get('/streaming/formats/:videoId', async (req, res) => {
  try {
    const { videoId } = req.params;
    const { source = 'youtube' } = req.query;
    
    console.log(`🎬 Centralized formats request for: ${videoId}`);
    
    // Forward request to gateway streaming service
    const gatewayUrl = process.env.GATEWAY_URL || 'http://gateway:3100';
    const response = await fetch(`${gatewayUrl}/api/streaming/youtube/formats/${videoId}?source=${source}`);
    
    if (response.ok) {
      const data = await response.json();
      res.json(data);
    } else {
      throw new Error(`Gateway error: ${response.status}`);
    }
    
  } catch (error) {
    console.error('❌ Centralized formats error:', error);
    res.status(500).json({ 
      error: 'Centralized formats failed', 
      details: error.message 
    });
  }
});

app.get('/streaming/channel/:channelId', async (req, res) => {
  try {
    const { channelId } = req.params;
    const { limit = 20 } = req.query;
    
    console.log(`📺 Centralized channel request for: ${channelId}`);
    
    // Forward request to gateway streaming service
    const gatewayUrl = process.env.GATEWAY_URL || 'http://gateway:3100';
    const response = await fetch(`${gatewayUrl}/api/streaming/youtube/channel/${channelId}?limit=${limit}`);
    
    if (response.ok) {
      const data = await response.json();
      res.json(data);
    } else {
      throw new Error(`Gateway error: ${response.status}`);
    }
    
  } catch (error) {
    console.error('❌ Centralized channel error:', error);
    res.status(500).json({ 
      error: 'Centralized channel failed', 
      details: error.message 
    });
  }
});

app.post('/config', async (req, res) => {
  try {
    const newConfig = req.body;
    
    // Validate and update config
    for (const [key, value] of Object.entries(newConfig)) {
      config.set(key, value);
    }
    
    await config.save();
    
    // Reinitialize services with new config
    if (newConfig.api_key !== undefined) {
      youtubeAPI = new YouTubeAPI(newConfig.api_key);
    }
    
    console.log('✅ Configuration updated');
    
    res.json({ success: true, config: config.getAll() });
    
  } catch (error) {
    console.error('❌ Config update error:', error);
    res.status(500).json({ 
      error: 'Failed to update configuration', 
      details: error.message 
    });
  }
});

// Start server
async function startServer() {
  try {
    await initializeServices();
    
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`🌐 OMG-Roma YouTube Plugin listening on: http://0.0.0.0:${PORT}`);
      console.log(`🔧 Configuration: ${config.get('search_mode')} mode`);
      console.log(`📺 Following ${config.get('followed_channels', []).length} channels`);
      console.log(`✅ Plugin is ready to accept requests`);
    });
    
  } catch (error) {
    console.error('❌ Failed to start OMG-Roma YouTube Plugin:', error);
    process.exit(1);
  }
}

startServer();
