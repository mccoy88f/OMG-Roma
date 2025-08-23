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
    
    // yt-dlp service is centralized in the gateway for video streaming
    console.log('ℹ️  yt-dlp service is centralized in OMG-Roma Gateway for video streaming');
    
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
                 ytdlp: 'centralized (streaming only)'
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
          ytdlp: 'centralized (streaming only)'
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
    const { search, skip = 0, limit = 20, api_key } = req.body;
    
    console.log(`🔍 YouTube search: "${search}" (skip: ${skip}, limit: ${limit})`);
    
    if (!search || search.trim().length === 0) {
      return res.json({ videos: [], hasMore: false });
    }
    
    // Use API key from request if provided, otherwise from config
    const searchApiKey = api_key || config.get('api_key');
    if (!searchApiKey) {
      throw new Error('YouTube API key not provided');
    }
    
    // Create temporary YouTube API instance for this request
    const tempYouTubeAPI = new YouTubeAPI(searchApiKey);
    
    try {
      console.log('🚀 Using YouTube API search');
      const result = await tempYouTubeAPI.search(search, { skip, limit });
      const videos = result.videos;
      const hasMore = result.hasMore;
      
      console.log(`✅ Found ${videos.length} videos`);
      res.json({ videos, hasMore });
    } catch (error) {
      console.error('❌ YouTube API search failed:', error.message);
      throw error;
    }
    
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
    const { skip = 0, limit = 20, catalogId } = req.body;
    
    // If catalogId is provided, it's a specific channel request
    if (catalogId && catalogId.startsWith('youtube_channel_')) {
      const channelId = catalogId.replace('youtube_channel_', '');
      console.log(`📺 YouTube channel discover: ${channelId} (skip: ${skip}, limit: ${limit})`);
      
      try {
        // Use API key from request if provided, otherwise from config
        const discoverApiKey = req.body.api_key || config.get('api_key');
        if (!discoverApiKey) {
          throw new Error('YouTube API key not provided');
        }
        
        // Create temporary YouTube API instance for this request
        const tempYouTubeAPI = new YouTubeAPI(discoverApiKey);
        
        // Get videos from specific channel using YouTube API
        const channelVideos = await tempYouTubeAPI.getChannelVideos(channelId, { skip, limit });
        console.log(`✅ Found ${channelVideos.length} videos from channel ${channelId}`);
        
        res.json({ 
          videos: channelVideos, 
          hasMore: channelVideos.length >= limit 
        });
      } catch (error) {
        console.error(`❌ Channel discover error for ${channelId}:`, error.message);
        res.status(500).json({ 
          error: 'Channel discover failed', 
          details: error.message,
          videos: [],
          hasMore: false
        });
      }
      return;
    }
    
    // General discover: get videos from all followed channels
    const followedChannels = config.get('followed_channels', []);
    console.log(`📺 YouTube general discover (skip: ${skip}, limit: ${limit})`);
    console.log(`Following ${followedChannels.length} channels`);
    
    if (followedChannels.length === 0) {
      return res.json({ 
        videos: [], 
        hasMore: false,
        message: 'No followed channels configured'
      });
    }
    
    let allVideos = [];
    
    // Get videos from all followed channels using YouTube API
    for (const channelUrl of followedChannels) {
      try {
        console.log(`📡 Fetching videos from: ${channelUrl}`);
        
        // Extract channel ID from URL
        let channelId = channelUrl;
        if (channelUrl.includes('@')) {
          // Handle @username format
          const username = channelUrl.split('@')[1].split('/')[0];
          // TODO: Convert username to channel ID using YouTube API
          console.log(`ℹ️  Using username: ${username} for channel discovery`);
        } else if (channelUrl.includes('channel/')) {
          // Handle /channel/ID format
          channelId = channelUrl.split('channel/')[1].split('/')[0];
        } else if (channelUrl.includes('c/')) {
          // Handle /c/username format
          const username = channelUrl.split('c/')[1].split('/')[0];
          // TODO: Convert custom URL to channel ID using YouTube API
          console.log(`ℹ️  Using custom URL: ${username} for channel discovery`);
        }
        
        // Use API key from request if provided, otherwise from config
        const discoverApiKey = req.body.api_key || config.get('api_key');
        if (!discoverApiKey) {
          throw new Error('YouTube API key not provided');
        }
        
        // Create temporary YouTube API instance for this request
        const tempYouTubeAPI = new YouTubeAPI(discoverApiKey);
        
        // Get videos from channel using YouTube API
        const channelVideos = await tempYouTubeAPI.getChannelVideos(channelId, {
          limit: Math.ceil(limit / followedChannels.length)
        });
        
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
    
    console.log(`✅ General discover found ${paginatedVideos.length} videos`);
    
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
    const { videoId, api_key } = req.body;
    
    console.log(`📝 Getting meta for: ${videoId}`);
    
    // Use API key from request if provided, otherwise from config
    const metaApiKey = api_key || config.get('api_key');
    if (!metaApiKey) {
      throw new Error('YouTube API key not provided');
    }
    
    // Create temporary YouTube API instance for this request
    const tempYouTubeAPI = new YouTubeAPI(metaApiKey);
    
    try {
      // Get video metadata using YouTube API
      const video = await tempYouTubeAPI.getVideoInfo(videoId);
      console.log(`✅ Meta retrieved for: ${video.title}`);
      res.json({ video });
    } catch (error) {
      console.error(`❌ Failed to get video metadata: ${error.message}`);
      res.status(404).json({ error: 'Video not found' });
    }
    
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
    
    // Get best audio and best video streams directly from gateway
    const gatewayUrl = process.env.GATEWAY_URL || 'http://gateway:3100';
    const response = await fetch(`${gatewayUrl}/api/streaming/youtube/stream/${videoId}?quality=best`);
    
    if (response.ok) {
      const data = await response.json();
      const streams = [
        {
          name: 'Best Video',
          url: data.videoUrl,
          quality: 'best',
          type: 'video'
        },
        {
          name: 'Best Audio',
          url: data.audioUrl,
          quality: 'best',
          type: 'audio'
        }
      ];
      
      console.log(`✅ Found ${streams.length} streams for: ${videoId}`);
      res.json({ streams });
    } else {
      console.warn(`⚠️  Gateway error for streams: ${response.status}`);
      res.json({ streams: [] });
    }
    
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
