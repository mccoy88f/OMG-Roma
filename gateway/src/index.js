const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');

const PluginManager = require('./plugin-manager');
const StremioAdapter = require('./stremio-adapter');
const WebUI = require('./web-ui');

const app = express();
const PORT = process.env.PORT || 3100;

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// Initialize components
const pluginManager = new PluginManager();
const stremioAdapter = new StremioAdapter(pluginManager);
const webUI = new WebUI(pluginManager);

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
    const manifest = await stremioAdapter.generateManifest();
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
    const extraParams = extra ? JSON.parse(decodeURIComponent(extra)) : {};
    
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

// Web UI routes
app.use('/api', webUI.getRouter());
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Start server
async function startServer() {
  try {
    console.log('🚀 Starting OMG-Roma...');
    
    // Initialize plugin manager
    await pluginManager.initialize();
    
    // Start discovering plugins
    await pluginManager.discoverPlugins();
    
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`🌐 Gateway server listening on: http://0.0.0.0:${PORT}`);
      console.log(`📱 Stremio manifest: http://localhost:${PORT}/manifest.json`);
      console.log(`⚙️  Web UI: http://localhost:${PORT}`);
      console.log(`📊 Health check: http://localhost:${PORT}/health`);
    });
    
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('🛑 Received SIGTERM, shutting down gracefully...');
  await pluginManager.shutdown();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('🛑 Received SIGINT, shutting down gracefully...');
  await pluginManager.shutdown();
  process.exit(0);
});

startServer();