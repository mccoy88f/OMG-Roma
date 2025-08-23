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
    const searchApiKey = api_key || req.body.youtube_api_key || config.get('api_key');
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
        const discoverApiKey = req.body.api_key || req.body.youtube_api_key || config.get('api_key');
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
    // Use channels from request if provided, otherwise from config
    const followedChannels = req.body.youtube_followed_channels || config.get('followed_channels', []);
    
    // If channels are comma-separated string, split them
    const channelList = Array.isArray(followedChannels) ? followedChannels : 
                       (typeof followedChannels === 'string' ? followedChannels.split(',') : []);
    
    console.log(`📺 YouTube general discover (skip: ${skip}, limit: ${limit})`);
    console.log(`Following ${channelList.length} channels`);
    
    if (channelList.length === 0) {
      return res.json({ 
        videos: [], 
        hasMore: false,
        message: 'No followed channels configured'
      });
    }
    
    let allVideos = [];
    
    // Get videos from all followed channels using YouTube API
    for (const channelUrl of channelList) {
      try {
        console.log(`📡 Fetching videos from: ${channelUrl}`);
        
        // Use API key from request if provided, otherwise from config
        const discoverApiKey = req.body.api_key || req.body.youtube_api_key || config.get('api_key');
        if (!discoverApiKey) {
          throw new Error('YouTube API key not provided');
        }
        
        // Create temporary YouTube API instance for this request
        const tempYouTubeAPI = new YouTubeAPI(discoverApiKey);
        
        // Resolve channel ID from URL (handles @username, /channel/, /c/)
        const channelId = await tempYouTubeAPI.resolveChannelId(channelUrl);
        console.log(`✅ Resolved channel URL: ${channelUrl} → ${channelId}`);
        
        // Get videos from channel using YouTube API
        const channelResult = await tempYouTubeAPI.getChannelVideos(channelId, {
          limit: Math.ceil(limit / channelList.length),
          skip: 0
        });
        
        console.log(`✅ Found ${channelResult.videos.length} videos from ${channelUrl}`);
        allVideos.push(...channelResult.videos);
        
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
    const metaApiKey = api_key || req.body.youtube_api_key || config.get('api_key');
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
    
    // Get multiple format options from gateway yt-dlp service
    const gatewayUrl = process.env.GATEWAY_URL || 'http://gateway:3100';
    const response = await fetch(`${gatewayUrl}/api/streaming/youtube/formats/${videoId}`);
    
    if (response.ok) {
      const data = await response.json();
      
      // Create multiple stream options with different qualities
      const streams = [];
      
      // Add best quality options
      if (data.bestVideo) {
        streams.push({
          name: '🎬 Best Video Quality',
          url: data.bestVideo,
          quality: 'best',
          type: 'video'
        });
      }
      
      if (data.bestAudio) {
        streams.push({
          name: '🎵 Best Audio Quality',
          url: data.bestAudio,
          quality: 'best',
          type: 'audio'
        });
      }
      
      // Add HLS streaming if available
      if (data.hlsUrl) {
        streams.push({
          name: '📡 HLS Streaming',
          url: data.hlsUrl,
          quality: 'adaptive',
          type: 'hls'
        });
      }
      
      // Add specific quality options
      if (data.formats) {
        // Add 1080p if available
        if (data.formats['1080p']) {
          streams.push({
            name: '🎬 1080p Full HD',
            url: data.formats['1080p'],
            quality: '1080p',
            type: 'video'
          });
        }
        
        // Add 720p if available
        if (data.formats['720p']) {
          streams.push({
            name: '📺 720p HD',
            url: data.formats['720p'],
            quality: '720p',
            type: 'video'
          });
        }
        
        // Add 480p if available
        if (data.formats['480p']) {
          streams.push({
            name: '📱 480p Standard',
            url: data.formats['480p'],
            quality: '480p',
            type: 'video'
          });
        }
      }
      
      // Fallback: if no specific formats, use basic best quality
      if (streams.length === 0 && data.videoUrl) {
        streams.push({
          name: '🎬 Best Available',
          url: data.videoUrl,
          quality: 'best',
          type: 'video'
        });
      }
      
      console.log(`✅ Found ${streams.length} stream options for: ${videoId}`);
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

// Get configuration schema
app.get('/config/schema', (req, res) => {
  try {
    const pluginInfo = require('../plugin.json');
    res.json({
      success: true,
      pluginId: pluginInfo.id,
      schema: pluginInfo.config_schema || {},
      description: pluginInfo.description
    });
  } catch (error) {
    console.error('❌ Error loading config schema:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to load configuration schema' 
    });
  }
});

// Test endpoint for plugin self-testing
app.post('/test', async (req, res) => {
  try {
    const { 
      testType = 'search', 
      query = 'test', 
      skip = 0, 
      limit = 5,
      // Test configuration (temporary, not saved)
      testConfig = {}
    } = req.body;

    console.log(`🧪 YouTube plugin test: ${testType} with config:`, Object.keys(testConfig));

    // Merge test config with current config (test config takes precedence)
    const mergedConfig = {
      ...config.getAll(),
      ...testConfig
    };

    console.log(`🔧 Using merged config for test:`, Object.keys(mergedConfig));

    let testResult;
    const startTime = Date.now();

    try {
      switch (testType) {
        case 'search':
          if (!mergedConfig.api_key) {
            throw new Error('API key required for search test');
          }
          
          const tempYouTubeAPI = new YouTubeAPI(mergedConfig.api_key);
          const searchResult = await tempYouTubeAPI.search(query, { skip, limit });
          
          testResult = {
            success: true,
            testType: 'search',
            query,
            duration: `${Date.now() - startTime}ms`,
            result: {
              videoCount: searchResult.videos?.length || 0,
              hasMore: searchResult.hasMore || false,
              sampleVideo: searchResult.videos?.[0] || null,
              videos: searchResult.videos || []
            }
          };
          break;

        case 'discover':
          if (!mergedConfig.api_key) {
            throw new Error('API key required for discover test');
          }
          
          if (!mergedConfig.followed_channels || mergedConfig.followed_channels.length === 0) {
            throw new Error('Followed channels required for discover test');
          }

          const discoverAPI = new YouTubeAPI(mergedConfig.api_key);
          const channelList = Array.isArray(mergedConfig.followed_channels) ? 
            mergedConfig.followed_channels : 
            mergedConfig.followed_channels.split(',');

          let allVideos = [];
          for (const channelUrl of channelList.slice(0, 2)) { // Test with max 2 channels
            try {
              const channelId = await discoverAPI.resolveChannelId(channelUrl);
              const channelResult = await discoverAPI.getChannelVideos(channelId, { limit: 3, skip: 0 });
              allVideos.push(...channelResult.videos);
            } catch (error) {
              console.warn(`⚠️  Channel test failed for ${channelUrl}:`, error.message);
            }
          }

          testResult = {
            success: true,
            testType: 'discover',
            duration: `${Date.now() - startTime}ms`,
            result: {
              channelCount: channelList.length,
              testedChannels: channelList.slice(0, 2),
              videoCount: allVideos.length,
              hasMore: allVideos.length >= limit,
              sampleVideos: allVideos.slice(0, 3),
              videos: allVideos
            }
          };
          break;

        case 'meta':
          if (!mergedConfig.api_key) {
            throw new Error('API key required for meta test');
          }
          
          // Use a known video ID for testing
          const testVideoId = 'dQw4w9WgXcQ'; // Rick Roll
          const metaAPI = new YouTubeAPI(mergedConfig.api_key);
          const videoMeta = await metaAPI.getVideoInfo(testVideoId);
          
          testResult = {
            success: true,
            testType: 'meta',
            duration: `${Date.now() - startTime}ms`,
            result: {
              videoId: testVideoId,
              video: videoMeta,
              metadataRetrieved: !!videoMeta
            }
          };
          break;

        case 'stream':
          // Test streaming endpoint (requires gateway)
          const gatewayUrl = process.env.GATEWAY_URL || 'http://gateway:3100';
          try {
            const response = await fetch(`${gatewayUrl}/api/streaming/youtube/formats/dQw4w9WgXcQ`);
            
            if (response.ok) {
              const streamData = await response.json();
              testResult = {
                success: true,
                testType: 'stream',
                duration: `${Date.now() - startTime}ms`,
                result: {
                  videoId: 'dQw4w9WgXcQ',
                  streamFormats: Object.keys(streamData),
                  hasStreams: Object.keys(streamData).length > 0,
                  sampleStream: streamData.bestVideo || streamData.videoUrl
                }
              };
            } else {
              throw new Error(`Gateway streaming error: ${response.status}`);
            }
          } catch (error) {
            throw new Error(`Streaming test failed: ${error.message}`);
          }
          break;

        default:
          throw new Error(`Unknown test type: ${testType}`);
      }

      console.log(`✅ Test completed successfully:`, testResult);
      res.json(testResult);

    } catch (testError) {
      testResult = {
        success: false,
        testType,
        duration: `${Date.now() - startTime}ms`,
        error: testError.message,
        result: null
      };
      
      console.error(`❌ Test failed:`, testError.message);
      res.json(testResult);
    }

  } catch (error) {
    console.error('❌ Test endpoint error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Test failed', 
      details: error.message 
    });
  }
});

// Channel catalog endpoint for Stremio
app.get('/catalog/channel/:channelId/:extra?.json', async (req, res) => {
  try {
    const { channelId, extra } = req.params;
    const { skip = 0, limit = 20 } = req.query;
    
    console.log(`📺 Channel catalog request: ${channelId} (skip: ${skip}, limit: ${limit})`);
    
    // Use API key from query if provided, otherwise from config
    const apiKey = req.query.api_key || req.query.youtube_api_key || config.get('api_key');
    if (!apiKey) {
      return res.status(400).json({ error: 'YouTube API key not provided' });
    }
    
    // Create temporary YouTube API instance
    const tempYouTubeAPI = new YouTubeAPI(apiKey);
    
    // Get channel info
    const channelInfo = await tempYouTubeAPI.getChannelInfo(channelId);
    console.log(`✅ Channel info: ${channelInfo.title}`);
    
    // Get channel videos
    const channelResult = await tempYouTubeAPI.getChannelVideos(channelId, { skip, limit });
    
    // Convert to Stremio catalog format
    const catalog = {
      metas: channelResult.videos.map(video => ({
        id: video.id,
        name: video.title,
        description: video.description,
        poster: video.thumbnail,
        background: video.thumbnail,
        type: 'movie',
        releaseInfo: video.publishedAt,
        runtime: video.duration,
        youtube: {
          channelId: video.channelId,
          channelTitle: video.channel,
          viewCount: video.viewCount,
          likeCount: video.likeCount
        }
      })),
      hasMore: channelResult.hasMore
    };
    
    console.log(`✅ Channel catalog: ${catalog.metas.length} videos`);
    res.json(catalog);
    
  } catch (error) {
    console.error('❌ Channel catalog error:', error);
    res.status(500).json({ 
      error: 'Channel catalog failed', 
      details: error.message 
    });
  }
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
