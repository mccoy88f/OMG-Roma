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
    // Check if configuration hash is provided
    const { config } = req.query;
    
    if (config) {
      console.log(`🔧 Generating personalized manifest for config: ${config}`);
    }
    
    const manifest = await stremioAdapter.generateManifest(config);
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
