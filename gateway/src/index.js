const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');

const PluginManager = require('./plugin-manager');
const StremioAdapter = require('./stremio-adapter');
const WebUI = require('./web-ui');
const StreamingManager = require('./streaming-manager');

const app = express();
const PORT = process.env.PORT || 3100;

// Middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'"]
    }
  }
}));
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// Initialize components
const pluginManager = new PluginManager();
const stremioAdapter = new StremioAdapter(pluginManager);
const webUI = new WebUI(pluginManager);
const streamingManager = new StreamingManager();

// Utility function to parse query strings
function parseQueryString(queryString) {
  const params = {};
  if (!queryString) return params;
  
  const pairs = queryString.split('&');
  for (const pair of pairs) {
    const [key, value] = pair.split('=');
    if (key && value) {
      params[decodeURIComponent(key)] = decodeURIComponent(value);
    }
  }
  return params;
}

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    plugins: pluginManager.getPluginStatus()
  });
});

// Stremio manifest
app.get('/manifest.json', async (req, res) => {
  try {
    // Get all query parameters for plugin configuration
    const configParams = req.url.includes('?') ? req.url.split('?')[1] : null;
    
    if (configParams) {
      console.log(`🔧 Generating personalized manifest with config: ${configParams}`);
    } else {
      console.log(`🔧 Generating default manifest (no config)`);
    }
    
    const manifest = await stremioAdapter.generateManifest(configParams);
    res.json(manifest);
  } catch (error) {
    console.error('❌ Error generating manifest:', error);
    res.status(500).json({ error: 'Failed to generate manifest' });
  }
});

// Stremio catalog endpoints
app.get('/catalog/:type/:catalogId/:extra?.json', async (req, res) => {
  try {
    const { type, catalogId, extra } = req.params;
    let extraParams = {};
    
    if (extra) {
      try {
        // Try to parse as JSON first
        extraParams = JSON.parse(decodeURIComponent(extra));
      } catch (jsonError) {
        // If JSON parsing fails, try to parse as query string
        console.log(`⚠️  JSON parsing failed for extra: ${extra}, trying query string parsing`);
        try {
          const queryString = decodeURIComponent(extra);
          extraParams = parseQueryString(queryString);
        } catch (queryError) {
          console.warn(`⚠️  Query string parsing also failed: ${queryError.message}`);
          extraParams = {};
        }
      }
    }
    
    // Add query parameters to extraParams (including plugin configs)
    Object.assign(extraParams, req.query);
    
    // Extract plugin configurations from manifest URL query params
    const referer = req.get('Referer');
    if (referer && referer.includes('manifest.json?')) {
      try {
        const manifestUrl = new URL(referer);
        const manifestParams = new URLSearchParams(manifestUrl.search);
        
        // Check for base64 encoded config
        const configParam = manifestParams.get('config');
        if (configParam) {
          try {
            // Decode base64 config
            const configJson = Buffer.from(configParam, 'base64').toString('utf8');
            const pluginConfigs = JSON.parse(configJson);
            
            console.log(`🔧 Decoded plugin configs from manifest:`, Object.keys(pluginConfigs));
            
            // Add plugin configs to extraParams for each plugin
            for (const [pluginId, config] of Object.entries(pluginConfigs)) {
              for (const [key, value] of Object.entries(config)) {
                extraParams[`${pluginId}_${key}`] = value;
              }
            }
            
          } catch (decodeError) {
            console.warn('⚠️  Failed to decode base64 config:', decodeError.message);
          }
        }
        
        console.log(`🔧 Added plugin configs to extraParams:`, Object.keys(extraParams).filter(k => k.includes('_')));
      } catch (error) {
        console.warn('⚠️  Failed to parse manifest params from referer:', error.message);
      }
    }
    
    // Parse extra parameter if it's a query string (e.g., "search=antonello migliorelli")
    if (extra && extra.includes('=')) {
      try {
        // Try to parse as query string first
        const queryParams = new URLSearchParams(extra);
        for (const [key, value] of queryParams) {
          extraParams[key] = value;
        }
        console.log(`🔧 Parsed extra as query string:`, Object.keys(extraParams));
      } catch (queryError) {
        console.warn('⚠️  Failed to parse extra as query string:', queryError.message);
      }
    }
    
    console.log(`🔍 Catalog request: ${catalogId}`, extraParams);
    
    const result = await stremioAdapter.handleCatalogRequest(catalogId, extraParams);
    res.json(result);
  } catch (error) {
    console.error('❌ Catalog error:', error);
    res.status(500).json({ metas: [] });
  }
});

// Stremio meta endpoints
app.get('/meta/:type/:id.json', async (req, res) => {
  try {
    const { type, id } = req.params;
    
    console.log(`📝 Meta request: ${id}`);
    
    const result = await stremioAdapter.handleMetaRequest(id);
    res.json(result);
  } catch (error) {
    console.error('❌ Meta error:', error);
    res.status(404).json({ meta: null });
  }
});

// Stremio stream endpoints
app.get('/stream/:type/:id.json', async (req, res) => {
  try {
    const { type, id } = req.params;
    
    console.log(`🎬 Stream request: ${id}`);
    
    const result = await stremioAdapter.handleStreamRequest(id);
    res.json(result);
  } catch (error) {
    console.error('❌ Stream error:', error);
    res.status(500).json({ streams: [] });
  }
});

// Direct proxy endpoints for streaming (based on oldv working version)
app.get('/proxy/:type/:id', async (req, res) => {
  try {
    const { type, id } = req.params;
    
    // Extract plugin ID and video ID from the combined ID
    const [pluginId, videoId] = id.split(':', 2);
    
    if (!pluginId || !videoId) {
      console.error(`❌ Invalid video ID format: ${id}`);
      return res.status(400).send('Invalid video ID format');
    }
    
    console.log(`🎬 Direct proxy request for ${pluginId}:${videoId}`);
    
    // Use streaming manager to handle the proxy
    await streamingManager.streamVideo(pluginId, videoId, null, 'best', req, res);
    
  } catch (error) {
    console.error('❌ Direct proxy error:', error);
    res.status(500).send('Streaming error');
  }
});

app.get('/proxy-best/:type/:id', async (req, res) => {
  try {
    const { type, id } = req.params;
    
    // Extract plugin ID and video ID from the combined ID
    const [pluginId, videoId] = id.split(':', 2);
    
    if (!pluginId || !videoId) {
      console.error(`❌ Invalid video ID format: ${id}`);
      return res.status(400).send('Invalid video ID format');
    }
    
    console.log(`🎯 Best quality proxy request for ${pluginId}:${videoId}`);
    
    // Use streaming manager with best quality
    await streamingManager.streamVideo(pluginId, videoId, null, 'bestvideo+bestaudio', req, res);
    
  } catch (error) {
    console.error('❌ Best quality proxy error:', error);
    res.status(500).send('Streaming error');
  }
});

app.get('/proxy-720/:type/:id', async (req, res) => {
  try {
    const { type, id } = req.params;
    
    // Extract plugin ID and video ID from the combined ID
    const [pluginId, videoId] = id.split(':', 2);
    
    if (!pluginId || !videoId) {
      console.error(`❌ Invalid video ID format: ${id}`);
      return res.status(400).send('Invalid video ID format');
    }
    
    console.log(`📺 720p proxy request for ${pluginId}:${videoId}`);
    
    // Use streaming manager with 720p quality
    await streamingManager.streamVideo(pluginId, videoId, null, 'bv*[height<=720]+ba/b[height<=720]', req, res);
    
  } catch (error) {
    console.error('❌ 720p proxy error:', error);
    res.status(500).send('Streaming error');
  }
});

app.get('/proxy-360/:type/:id', async (req, res) => {
  try {
    const { type, id } = req.params;
    
    // Extract plugin ID and video ID from the combined ID
    const [pluginId, videoId] = id.split(':', 2);
    
    if (!pluginId || !videoId) {
      console.error(`❌ Invalid video ID format: ${id}`);
      return res.status(400).send('Invalid video ID format');
    }
    
    console.log(`📱 360p proxy request for ${pluginId}:${videoId}`);
    
    // Use streaming manager with 360p quality
    await streamingManager.streamVideo(pluginId, videoId, null, 'bv*[height<=360]+ba/b[height<=360]', req, res);
    
  } catch (error) {
    console.error('❌ 360p proxy error:', error);
    res.status(500).send('Streaming error');
  }
});

// YouTube streaming endpoints (for plugin integration)
app.get('/api/streaming/youtube/stream/:videoId', async (req, res) => {
  try {
    const { videoId } = req.params;
    const { format = 'bestvideo+bestaudio' } = req.query;
    
    console.log(`🎬 YouTube stream request for: ${videoId} with format: ${format}`);
    
    // Use streaming manager to get stream info
    const streamInfo = await streamingManager.getStreamInfo('youtube', videoId, format);
    
    if (streamInfo && streamInfo.url) {
      res.json({
        url: streamInfo.url,
        title: streamInfo.title || 'Unknown Video',
        channel: streamInfo.channel || 'Unknown Channel',
        quality: streamInfo.quality || 'Best Available',
        format: streamInfo.format || 'mp4'
      });
    } else {
      // Fallback: generate proxy URL
      const proxyUrl = `${req.protocol}://${req.get('host')}/proxy-best/channel/youtube:${videoId}`;
      res.json({
        url: proxyUrl,
        title: 'Unknown Video',
        channel: 'Unknown Channel',
        quality: 'Best Available',
        format: 'mp4'
      });
    }
    
  } catch (error) {
    console.error('❌ YouTube stream error:', error);
    // Fallback: generate proxy URL
    const proxyUrl = `${req.protocol}://${req.get('host')}/proxy-best/channel/youtube:${videoId}`;
    res.json({
      url: proxyUrl,
      title: 'Unknown Video',
      channel: 'Unknown Channel',
      quality: 'Best Available',
      format: 'mp4'
    });
  }
});

// Streaming API endpoints
app.get('/api/streaming/:pluginId/search', async (req, res) => {
  try {
    const { pluginId } = req.params;
    const { query, limit, skip, searchType, dateFilter, durationFilter } = req.query;
    
    const results = await streamingManager.searchVideos(pluginId, query, {
      limit: parseInt(limit) || 20,
      skip: parseInt(skip) || 0,
      searchType,
      dateFilter,
      durationFilter
    });
    
    res.json(results);
  } catch (error) {
    console.error('❌ Streaming search error:', error);
    res.status(500).json({ error: 'Search failed', details: error.message });
  }
});

app.get('/api/streaming/:pluginId/info/:videoId', async (req, res) => {
  try {
    const { pluginId, videoId } = req.params;
    
    const videoInfo = await streamingManager.getVideoInfo(pluginId, videoId);
    res.json(videoInfo);
  } catch (error) {
    console.error('❌ Streaming info error:', error);
    res.status(500).json({ error: 'Info failed', details: error.message });
  }
});

app.get('/api/streaming/:pluginId/formats/:videoId', async (req, res) => {
  try {
    const { pluginId, videoId } = req.params;
    const { source = 'youtube' } = req.query;
    
    const formats = await streamingManager.getStreamFormats(pluginId, videoId, source);
    res.json(formats);
  } catch (error) {
    console.error('❌ Streaming formats error:', error);
    res.status(500).json({ error: 'Formats failed', details: error.message });
  }
});

app.get('/api/streaming/:pluginId/proxy/:videoId', async (req, res) => {
  try {
    const { pluginId, videoId } = req.params;
    const { quality = 'best', format } = req.query;
    
    await streamingManager.streamVideo(pluginId, videoId, format, quality, req, res);
  } catch (error) {
    console.error('❌ Streaming proxy error:', error);
    res.status(500).json({ error: 'Streaming failed', details: error.message });
  }
});

app.get('/api/streaming/:pluginId/channel/:channelId', async (req, res) => {
  try {
    const { pluginId, channelId } = req.params;
    const { limit = 20 } = req.query;
    
    const videos = await streamingManager.getChannelVideos(pluginId, channelId, {
      limit: parseInt(limit) || 20
    });
    res.json(videos);
  } catch (error) {
    console.error('❌ Streaming channel error:', error);
    res.status(500).json({ error: 'Channel failed', details: error.message });
  }
});

app.get('/api/streaming/:pluginId/thumbnail/:videoId', async (req, res) => {
  try {
    const { pluginId, videoId } = req.params;
    
    await streamingManager.getThumbnail(pluginId, videoId, req, res);
  } catch (error) {
    console.error('❌ Streaming thumbnail error:', error);
    res.status(500).json({ error: 'Thumbnail failed', details: error.message });
  }
});

app.get('/api/streaming/:pluginId/subtitles/:videoId', async (req, res) => {
  try {
    const { pluginId, videoId } = req.params;
    const { language = 'en' } = req.query;
    
    await streamingManager.getSubtitles(pluginId, videoId, language, req, res);
  } catch (error) {
    console.error('❌ Streaming subtitles error:', error);
    res.status(500).json({ error: 'Subtitles failed', details: error.message });
  }
});

// Combine video and audio streams endpoint
app.get('/api/streaming/:pluginId/combine/:videoId', async (req, res) => {
  try {
    const { pluginId, videoId } = req.params;
    const { video, audio } = req.query;
    
    if (!video || !audio) {
      return res.status(400).json({ 
        error: 'Missing video or audio format ID',
        required: ['video', 'audio'],
        received: { video, audio }
      });
    }
    
    console.log(`🎬 Combining streams for ${pluginId}:${videoId} (video: ${video}, audio: ${audio})`);
    
    // Use streaming manager to combine streams
    await streamingManager.combineStreams(pluginId, videoId, video, audio, req, res);
    
  } catch (error) {
    console.error('❌ Stream combine error:', error);
    res.status(500).json({ error: 'Stream combine failed', details: error.message });
  }
});

// Streaming statistics
app.get('/api/streaming/stats', (req, res) => {
  try {
    const stats = streamingManager.getGlobalStats();
    res.json(stats);
  } catch (error) {
    console.error('❌ Streaming stats error:', error);
    res.status(500).json({ error: 'Stats failed', details: error.message });
  }
});

app.get('/api/streaming/:pluginId/stats', (req, res) => {
  try {
    const { pluginId } = req.params;
    const stats = streamingManager.getPluginStats(pluginId);
    res.json(stats);
  } catch (error) {
    console.error('❌ Plugin streaming stats error:', error);
    res.status(500).json({ error: 'Plugin stats failed', details: error.message });
  }
});

// Web UI routes
app.use('/api', webUI.getRouter());
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Start server
async function startServer() {
  try {
    console.log('🚀 Starting OMG-Roma...');
    
    // Initialize streaming manager
    console.log('🎬 Initializing StreamingManager...');
    await streamingManager.initialize();
    
    // Initialize plugin manager
    console.log('🔌 Initializing PluginManager...');
    await pluginManager.initialize();
    
    // Start discovering plugins
    console.log('🔍 Discovering plugins...');
    await pluginManager.discoverPlugins();
    
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`🌐 Gateway server listening on: http://0.0.0.0:${PORT}`);
      console.log(`📱 Stremio manifest: http://localhost:${PORT}/manifest.json`);
      console.log(`⚙️  Web UI: http://localhost:${PORT}`);
      console.log(`📊 Health check: http://localhost:${PORT}/health`);
      console.log(`🎬 Streaming API: http://localhost:${PORT}/api/streaming`);
    });
    
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('🛑 Received SIGTERM, shutting down gracefully...');
  await streamingManager.shutdown();
  await pluginManager.shutdown();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('🛑 Received SIGINT, shutting down gracefully...');
  await streamingManager.shutdown();
  await pluginManager.shutdown();
  process.exit(0);
});

startServer();
