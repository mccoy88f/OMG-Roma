const express = require('express');
const fs = require('fs-extra');
const path = require('path');

const YouTubeAPI = require('./youtube-api');
const YtDlpService = require('./ytdlp-service');
const ConfigManager = require('./config-manager');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(express.json());

// Initialize services
let config;
let youtubeAPI;
let ytdlpService;

async function initializeServices() {
  try {
    console.log('🎥 Initializing OMG-Roma YouTube Plugin...');
    
    // Load configuration
    config = new ConfigManager(process.env.CONFIG_FILE || '/app/config.json');
    await config.load();
    
    // Initialize YouTube API
    youtubeAPI = new YouTubeAPI(config.get('api_key'));
    
    // Initialize yt-dlp service
    ytdlpService = new YtDlpService(config);
    await ytdlpService.checkAvailability();
    
    console.log('✅ OMG-Roma YouTube Plugin initialized successfully');
    
  } catch (error) {
    console.error('❌ Failed to initialize OMG-Roma YouTube Plugin:', error);
    throw error;
  }
}

// Plugin info endpoint
app.get('/plugin.json', (req, res) => {
  try {
    const pluginInfo = require('../plugin.json');
    res.json(pluginInfo);
  } catch (error) {
    res.status(404).json({ error: 'Plugin info not found' });
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
      ytdlp: ytdlpService ? ytdlpService.isAvailable() : false
    }
  });
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
      const result = await ytdlpService.search(search, { skip, limit });
      videos = result.videos;
      hasMore = result.hasMore;
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
        
        const channelVideos = await ytdlpService.getChannelVideos(channelUrl, {
          limit: Math.ceil(limit / followedChannels.length)
        });
        
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
    
    const video = await ytdlpService.getVideoInfo(videoId);
    
    if (!video) {
      return res.status(404).json({ error: 'Video not found' });
    }
    
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
    
    const streams = await ytdlpService.getVideoStreams(videoId);
    
    if (!streams || streams.length === 0) {
      return res.json({ streams: [] });
    }
    
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
    });
    
  } catch (error) {
    console.error('❌ Failed to start OMG-Roma YouTube Plugin:', error);
    process.exit(1);
  }
}

startServer();
