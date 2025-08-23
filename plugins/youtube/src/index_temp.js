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
    console.log(`🔧 Search request body:`, req.body);
    
    if (!search || search.trim().length === 0) {
      return res.json({ videos: [], hasMore: false });
    }
    
    // Use API key from request if provided, otherwise from config
    const searchApiKey = api_key || req.body.api_key || config.get('api_key');
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
    const { skip = 0, limit = 20, catalogId, channelFilter } = req.body;
    
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
    
    // Apply channel filter if specified
    let filteredChannels = channelList;
    if (channelFilter && channelFilter !== 'all') {
      // Find channel by name or ID
      const filteredChannel = channelList.find(channel => 
        channel.includes(channelFilter) || 
        channel.toLowerCase().includes(channelFilter.toLowerCase())
      );
      if (filteredChannel) {
        filteredChannels = [filteredChannel];
        console.log(`🔍 Filtering by channel: ${filteredChannel}`);
      }
    }
    
    let allVideos = [];
    
    // Get videos from filtered channels using YouTube API
    for (const channelUrl of filteredChannels) {
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
          limit: Math.ceil(limit / filteredChannels.length),
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
      hasMore,
      channelFilter: channelFilter || 'all',
      totalChannels: filteredChannels.length
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

// Meta endpoint for Stremio
app.post('/meta', async (req, res) => {
  try {
    const { videoId, api_key } = req.body;
    
    // Handle Stremio format: youtube:videoId -> videoId
    const cleanVideoId = videoId && videoId.includes(':') ? videoId.split(':')[1] : videoId;
    
    console.log(`📝 Getting meta for: ${videoId} (cleaned: ${cleanVideoId})`);
    
    if (!cleanVideoId) {
      return res.status(400).json({ error: 'Invalid video ID' });
    }
    
    // Use API key from request if provided, otherwise from config
    const metaApiKey = api_key || req.body.api_key || config.get('api_key');
    if (!metaApiKey) {
      throw new Error('YouTube API key not provided');
    }
    
    // Create temporary YouTube API instance for this request
    const tempYouTubeAPI = new YouTubeAPI(metaApiKey);
    
    try {
      // Get video metadata using YouTube API
      const video = await tempYouTubeAPI.getVideoInfo(cleanVideoId);
      console.log(`✅ Meta retrieved for: ${video.title}`);
      
      // Convert to Stremio meta format
      const meta = {
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
      };
      
      res.json({ meta });
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

// Meta endpoint for Stremio (GET method)
app.get('/meta/:videoId.json', async (req, res) => {
  try {
    const { videoId } = req.params;
    
    // Handle Stremio format: youtube:videoId -> videoId
    const cleanVideoId = videoId && videoId.includes(':') ? videoId.split(':')[1] : videoId;
    
    console.log(`📝 Getting meta for: ${videoId} (GET) (cleaned: ${cleanVideoId})`);
    
    if (!cleanVideoId) {
      return res.status(400).json({ error: 'Invalid video ID' });
    }
    
    // Use API key from query if provided, otherwise from config
    const metaApiKey = req.query.api_key || req.query.youtube_api_key || config.get('api_key');
    if (!metaApiKey) {
      return res.status(400).json({ error: 'YouTube API key not provided' });
    }
    
    // Create temporary YouTube API instance for this request
    const tempYouTubeAPI = new YouTubeAPI(metaApiKey);
    
    try {
      // Get video metadata using YouTube API
      const video = await tempYouTubeAPI.getVideoInfo(cleanVideoId);
      console.log(`✅ Meta retrieved for: ${video.title}`);
      
      // Convert to Stremio meta format
      const meta = {
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
      };
      
      res.json({ meta });
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

// Stream endpoint for Stremio
app.post('/stream', async (req, res) => {
  try {
    const { videoId } = req.body;
    
    // Handle Stremio format: youtube:videoId -> videoId
    const cleanVideoId = videoId && videoId.includes(':') ? videoId.split(':')[1] : videoId;
    
    console.log(`🎬 Getting streams for: ${videoId} (cleaned: ${cleanVideoId})`);
    
    if (!cleanVideoId) {
      return res.status(400).json({ error: 'Invalid video ID', streams: [] });
    }
    
    // Get multiple format options from gateway yt-dlp service
    const gatewayUrl = process.env.GATEWAY_URL || 'http://gateway:3100';
    const response = await fetch(`${gatewayUrl}/api/streaming/youtube/formats/${cleanVideoId}`);
    
    if (response.ok) {
      const data = await response.json();
      
      // Create multiple stream options with different qualities
      const streams = [];
      
      // Handle formats returned by gateway - Create single combined stream like OMG-youtube
      if (data && Array.isArray(data)) {
        // Get video info for naming
        let videoTitle = 'Unknown Video';
        let channelName = 'Unknown Author';
        let bestQuality = 'Unknown Quality';
        
        // Try to extract video info from the first format
        if (data[0] && data[0].video_title) {
          videoTitle = data[0].video_title;
        }
        if (data[0] && data[0].channel_name) {
          channelName = data[0].channel_name;
        }
        
        // Find best quality from available formats
        const videoFormats = data.filter(f => f.type === 'video' && f.height);
        if (videoFormats.length > 0) {
          const bestVideo = videoFormats.reduce((best, current) => 
            (current.height || 0) > (best.height || 0) ? current : best
          );
          bestQuality = `${bestVideo.height}p`;
        }
        
        // Create REAL combined stream using bestvideo+bestaudio (like OMG-youtube)
        const gatewayUrl = process.env.GATEWAY_URL || 'http://gateway:3100';
        // Use the actual combined stream URL from gateway, not proxy
        const combinedUrl = `${gatewayUrl}/api/streaming/youtube/formats/${cleanVideoId}?format=bestvideo+bestaudio`;
        
        // Single stream with OMG-Roma format
        const name = `OMG-Roma: YouTube`;
        const title = `${videoTitle} (${channelName}) - ${bestQuality}`;
        
        streams.push({
          name: name,
          title: title,
          url: combinedUrl,
          behaviorHints: {
            bingeWatch: true
          }
        });
        
        console.log(`✅ Created real combined stream: ${name} - ${title}`);
      }
      
      // Fallback: if no formats found, create proxy stream
      if (streams.length === 0) {
        const gatewayUrl = process.env.GATEWAY_URL || 'http://gateway:3100';
        streams.push({
          name: `OMG-Roma: YouTube`,
          title: `Unknown Video (Unknown Author) - Best Available`,
          url: `${gatewayUrl}/api/streaming/youtube/proxy/${cleanVideoId}?quality=best`,
          behaviorHints: {
            bingeWatch: true
          }
        });
      }
      
      console.log(`✅ Found ${streams.length} stream options for: ${cleanVideoId}`);
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

// Meta endpoint for Stremio (GET method)
app.get('/meta/:videoId.json', async (req, res) => {
  try {
    const { videoId } = req.params;
    
    // Handle Stremio format: youtube:videoId -> videoId
    const cleanVideoId = videoId && videoId.includes(':') ? videoId.split(':')[1] : videoId;
    
    console.log(`📝 Getting meta for: ${videoId} (cleaned: ${cleanVideoId})`);
    
    if (!cleanVideoId) {
      return res.status(400).json({ error: 'Invalid video ID' });
    }
    
    // Get video info from gateway
    const gatewayUrl = process.env.GATEWAY_URL || 'http://gateway:3100';
    const response = await fetch(`${gatewayUrl}/api/streaming/youtube/formats/${cleanVideoId}`);
    
    if (response.ok) {
      const data = await response.json();
      
      if (data && Array.isArray(data) && data.length > 0) {
        const videoInfo = data[0];
        
        // Create meta response following Stremio format
        const meta = {
          id: `youtube:${cleanVideoId}`,
          type: 'movie',
          name: videoInfo.title || 'Unknown Title',
          description: videoInfo.description || '',
          poster: videoInfo.thumbnail || '',
          background: videoInfo.thumbnail || '',
          cast: [videoInfo.channel || 'Unknown Channel'],
          director: videoInfo.channel || 'Unknown Channel',
          genre: ['YouTube'],
          releaseInfo: videoInfo.publishedAt ? new Date(videoInfo.publishedAt).getFullYear().toString() : 'Unknown',
          runtime: videoInfo.duration ? Math.floor(videoInfo.duration / 60) + ':' + (videoInfo.duration % 60).toString().padStart(2, '0') : 'Unknown',
          videos: [
            {
              id: `youtube:${cleanVideoId}`,
              name: videoInfo.title || 'Unknown Title',
              released: videoInfo.publishedAt ? new Date(videoInfo.publishedAt).getFullYear().toString() : 'Unknown'
            }
          ]
        };
        
        console.log(`✅ Meta created for: ${cleanVideoId}`);
        res.json({ meta });
      } else {
        console.warn(`⚠️  No video info found for: ${cleanVideoId}`);
        res.status(404).json({ error: 'Video not found' });
      }
    } else {
      console.warn(`⚠️  Gateway error for meta: ${response.status}`);
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

// Stream endpoint for Stremio (GET method)
app.get('/stream/:videoId.json', async (req, res) => {
  try {
    const { videoId } = req.params;
    
    // Handle Stremio format: youtube:videoId -> videoId
    const cleanVideoId = videoId && videoId.includes(':') ? videoId.split(':')[1] : videoId;
    
    console.log(`🎬 Getting streams for: ${videoId} (GET) (cleaned: ${cleanVideoId})`);
    
    if (!cleanVideoId) {
      return res.status(400).json({ error: 'Invalid video ID', streams: [] });
    }
    
    // Get multiple format options from gateway yt-dlp service
    const gatewayUrl = process.env.GATEWAY_URL || 'http://gateway:3100';
    const response = await fetch(`${gatewayUrl}/api/streaming/youtube/formats/${cleanVideoId}`);
    
    if (response.ok) {
      const data = await response.json();
      
      // Create multiple stream options with different qualities
      const streams = [];
      
      // Handle formats returned by gateway - Create single combined stream like OMG-youtube
      if (data && Array.isArray(data)) {
        // Get video info for naming
        let videoTitle = 'Unknown Video';
        let channelName = 'Unknown Author';
        let bestQuality = 'Unknown Quality';
        
        // Try to extract video info from the first format
        if (data[0] && data[0].video_title) {
          videoTitle = data[0].video_title;
        }
        if (data[0] && data[0].channel_name) {
          channelName = data[0].channel_name;
        }
        
        // Find best quality from available formats
        const videoFormats = data.filter(f => f.type === 'video' && f.height);
        if (videoFormats.length > 0) {
          const bestVideo = videoFormats.reduce((best, current) => 
            (current.height || 0) > (best.height || 0) ? current : best
          );
          bestQuality = `${bestVideo.height}p`;
        }
        
        // Create REAL combined stream using bestvideo+bestaudio (like OMG-youtube)
        const gatewayUrl = process.env.GATEWAY_URL || 'http://gateway:3100';
        // Use the actual combined stream URL from gateway, not proxy
        const combinedUrl = `${gatewayUrl}/api/streaming/youtube/formats/${cleanVideoId}?format=bestvideo+bestaudio`;
        
        // Single stream with OMG-Roma format
        const name = `OMG-Roma: YouTube`;
        const title = `${videoTitle} (${channelName}) - ${bestQuality}`;
        
        streams.push({
          name: name,
          title: title,
          url: combinedUrl,
          behaviorHints: {
            bingeWatch: true
          }
        });
        
        console.log(`✅ Created real combined stream: ${name} - ${title}`);
      }
      
      // Fallback: if no formats found, create proxy stream
      if (streams.length === 0) {
        const gatewayUrl = process.env.GATEWAY_URL || 'http://gateway:3100';
        streams.push({
          name: `OMG-Roma: YouTube`,
          title: `Unknown Video (Unknown Author) - Best Available`,
          url: `${gatewayUrl}/api/streaming/youtube/proxy/${cleanVideoId}?quality=best`,
          behaviorHints: {
            bingeWatch: true
          }
        });
      }
      
      console.log(`✅ Found ${streams.length} stream options for: ${cleanVideoId}`);
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
              meta: videoMeta,
              metadataRetrieved: !!videoMeta,
              title: videoMeta?.title || 'Unknown'
            }
          };
          break;

        case 'stream':
          // Test streaming endpoint (requires gateway)
          const gatewayUrl = process.env.GATEWAY_URL || 'http://gateway:3100';
          try {
            console.log('🎬 Testing streaming with gateway (bestvideo+bestaudio)...');
            const response = await fetch(`${gatewayUrl}/api/streaming/youtube/formats/dQw4w9WgXcQ`);
            
            if (response.ok) {
              const streamData = await response.json();
              
              // Analyze the returned formats for bestvideo+bestaudio
              const formatAnalysis = {
                total: Array.isArray(streamData) ? streamData.length : 0,
                combined: 0,
                video: 0,
                audio: 0,
                proxy: 0,
                direct: 0
              };
              
              if (Array.isArray(streamData)) {
                streamData.forEach(format => {
                  if (format.type === 'combined') formatAnalysis.combined++;
                  else if (format.type === 'video') formatAnalysis.video++;
                  else if (format.type === 'audio') formatAnalysis.audio++;
                  else if (format.type === 'proxy') formatAnalysis.proxy++;
                  else if (format.type === 'direct') formatAnalysis.direct++;
                });
              }
              
              testResult = {
                success: true,
                testType: 'stream',
                duration: `${Date.now() - startTime}ms`,
                result: {
                  videoId: 'dQw4w9WgXcQ',
                  streamFormats: streamData,
                  formatAnalysis: formatAnalysis,
                  hasStreams: formatAnalysis.total > 0,
                  bestvideo_bestaudio: formatAnalysis.combined > 0 || (formatAnalysis.video > 0 && formatAnalysis.audio > 0),
                  sampleStream: streamData[0] || null
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

// Get list of followed channels
app.get('/channels', async (req, res) => {
  try {
    const followedChannels = config.get('followed_channels', []);
    const channelList = Array.isArray(followedChannels) ? followedChannels : 
                       (typeof followedChannels === 'string' ? followedChannels.split(',') : []);
    
    console.log(`📺 Getting list of ${channelList.length} followed channels`);
    
    res.json({
      success: true,
      channels: channelList.map(channel => ({
        url: channel,
        name: channel.split('/').pop() || channel,
        type: 'youtube'
      })),
      total: channelList.length
    });
    
  } catch (error) {
    console.error('❌ Error getting channels:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to get channels list',
      channels: []
    });
  }
});

// YouTube channels catalog endpoint for Stremio (general catalog with filters)
app.get('/catalog/channels/YouTube/:extra?.json', async (req, res) => {
  try {
    const { extra } = req.params;
    const { skip = 0, limit = 20, filter } = req.query;
    
    console.log(`📺 YouTube channels catalog request (skip: ${skip}, limit: ${limit}, filter: ${filter || 'all'})`);
    
    // Use API key from query if provided, otherwise from config
    const apiKey = req.query.api_key || req.query.youtube_api_key || config.get('api_key');
    if (!apiKey) {
      return res.status(400).json({ error: 'YouTube API key not provided' });
    }
    
    // Create temporary YouTube API instance
    const tempYouTubeAPI = new YouTubeAPI(apiKey);
    
    // Get followed channels from config
    const followedChannels = config.get('followed_channels', []);
    
    if (followedChannels.length === 0) {
      console.log('⚠️  No followed channels configured');
      return res.json({ metas: [], hasMore: false });
    }
    
    let allVideos = [];
    
    if (filter) {
      // Filter by specific channel
      const cleanChannelId = filter.includes(':') ? filter.split(':')[1] : filter;
      
      console.log(`🎯 Filtering by channel: ${cleanChannelId}`);
      
      try {
        const channelResult = await tempYouTubeAPI.getChannelVideos(cleanChannelId, { skip, limit });
        allVideos = channelResult.videos;
        
        // Convert to Stremio catalog format
        const catalog = {
          metas: allVideos.map(video => ({
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
        
        console.log(`✅ Filtered catalog: ${catalog.metas.length} videos from channel ${cleanChannelId}`);
        res.json(catalog);
        
      } catch (error) {
        console.error(`❌ Error filtering by channel ${cleanChannelId}:`, error);
        res.status(500).json({ 
          error: 'Channel filter failed', 
          details: error.message,
          metas: [],
          hasMore: false
        });
      }
      
    } else {
      // Show videos from all followed channels
      console.log(`🌐 Getting videos from ${followedChannels.length} followed channels`);
      
      try {
        // Get videos from all followed channels
        for (const channelUrl of followedChannels) {
          try {
            // Extract channel ID from URL or use as-is
            const channelId = channelUrl.includes('channel/') 
              ? channelUrl.split('channel/')[1].split('/')[0]
              : channelUrl.includes('@') 
                ? channelUrl.split('@')[1].split('/')[0]
                : channelUrl;
            
            const channelResult = await tempYouTubeAPI.getChannelVideos(channelId, { skip: 0, limit: Math.ceil(limit / followedChannels.length) });
            allVideos.push(...channelResult.videos);
            
          } catch (channelError) {
            console.warn(`⚠️  Failed to get videos from channel: ${channelUrl}`, channelError.message);
          }
        }
        
        // Sort by publication date (most recent first)
        allVideos.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
        
        // Apply pagination
        const paginatedVideos = allVideos.slice(skip, skip + limit);
        
        // Convert to Stremio catalog format
        const catalog = {
          metas: paginatedVideos.map(video => ({
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
          hasMore: allVideos.length > (skip + limit)
        };
        
        console.log(`✅ General catalog: ${catalog.metas.length} videos from all channels`);
        res.json(catalog);
        
      } catch (error) {
        console.error('❌ Error getting videos from all channels:', error);
        res.status(500).json({ 
          error: 'General catalog failed', 
          details: error.message,
          metas: [],
          hasMore: false
        });
      }
    }
    
  } catch (error) {
    console.error('❌ Channel catalog error:', error);
    res.status(500).json({ 
      error: 'Channel catalog failed', 
      details: error.message 
    });
  }
});

// Search catalog endpoint for Stremio - REMOVED from Scopri
// This endpoint was creating an empty "Ricerca YouTube" entry in Stremio
// Search functionality is still available via /search endpoint and other methods

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
