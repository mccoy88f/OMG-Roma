const fs = require('fs-extra');
const path = require('path');
const axios = require('axios');
const chokidar = require('chokidar');

class PluginManager {
  constructor() {
    this.plugins = new Map();
    this.configDir = process.env.CONFIG_DIR || path.join(__dirname, '../config');
    this.pluginsDir = process.env.PLUGINS_DIR || path.join(__dirname, '../plugins');
    this.registryFile = path.join(this.configDir, 'plugins.json');
    this.watcher = null;
  }

  async initialize() {
    console.log('🔧 Initializing Plugin Manager...');
    
    // Ensure directories exist
    await fs.ensureDir(this.configDir);
    await fs.ensureDir(this.pluginsDir);
    
    // Load plugin registry
    await this.loadPluginRegistry();
    
    // Watch for plugin changes
    this.startWatching();
    
    console.log('✅ Plugin Manager initialized');
  }

  async loadPluginRegistry() {
    try {
      if (await fs.pathExists(this.registryFile)) {
        const registry = await fs.readJson(this.registryFile);
        console.log(`📋 Loaded plugin registry with ${Object.keys(registry).length} plugins`);
        return registry;
      }
    } catch (error) {
      console.error('❌ Error loading plugin registry:', error);
    }
    
    // Create default registry
    const defaultRegistry = {
      plugins: {},
      last_updated: new Date().toISOString()
    };
    await fs.writeJson(this.registryFile, defaultRegistry, { spaces: 2 });
    return defaultRegistry;
  }

  async discoverPlugins() {
    console.log('🔍 Discovering plugins...');
    
    try {
      const pluginDirs = await fs.readdir(this.pluginsDir);
      
      for (const pluginDir of pluginDirs) {
        if (pluginDir.startsWith('.')) continue;
        
        const pluginPath = path.join(this.pluginsDir, pluginDir);
        const pluginJsonPath = path.join(pluginPath, 'plugin.json');
        
        if (await fs.pathExists(pluginJsonPath)) {
          await this.loadPlugin(pluginDir, pluginJsonPath);
        }
      }
      
      // Wait for plugins to be ready
      await this.waitForPluginsReady();
      
      console.log(`✅ Discovered ${this.plugins.size} plugins`);
      
    } catch (error) {
      console.error('❌ Error discovering plugins:', error);
    }
  }

  async loadPlugin(pluginId, pluginJsonPath) {
    try {
      const pluginConfig = await fs.readJson(pluginJsonPath);
      
      // Validate plugin config
      if (!this.validatePluginConfig(pluginConfig)) {
        console.error(`❌ Invalid plugin config for ${pluginId}`);
        return false;
      }
      
      // Register plugin
      const plugin = {
        id: pluginId,
        config: pluginConfig,
        baseUrl: `http://${pluginId}-plugin:${pluginConfig.port}`,
        status: 'discovered',
        lastHealthCheck: null
      };
      
      this.plugins.set(pluginId, plugin);
      console.log(`📦 Loaded plugin: ${pluginConfig.name} (${pluginId})`);
      
      return true;
      
    } catch (error) {
      console.error(`❌ Error loading plugin ${pluginId}:`, error);
      return false;
    }
  }

  validatePluginConfig(config) {
    const required = ['id', 'name', 'version', 'port', 'endpoints', 'stremio'];
    
    for (const field of required) {
      if (!config[field]) {
        console.error(`❌ Missing required field: ${field}`);
        return false;
      }
    }
    
    return true;
  }

  async waitForPluginsReady(timeout = 30000) {
    console.log('⏳ Waiting for plugins to be ready...');
    
    const startTime = Date.now();
    const checkInterval = 2000;
    
    while (Date.now() - startTime < timeout) {
      let allReady = true;
      
      for (const [pluginId, plugin] of this.plugins) {
        try {
          const healthCheck = await this.checkPluginHealth(pluginId);
          if (!healthCheck.healthy) {
            allReady = false;
            break;
          }
        } catch (error) {
          allReady = false;
          break;
        }
      }
      
      if (allReady) {
        console.log('✅ All plugins are ready');
        return true;
      }
      
      await new Promise(resolve => setTimeout(resolve, checkInterval));
    }
    
    console.warn('⚠️  Timeout waiting for plugins to be ready');
    return false;
  }

  async checkPluginHealth(pluginId) {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) {
      return { healthy: false, error: 'Plugin not found' };
    }
    
    try {
      const response = await axios.get(`${plugin.baseUrl}/health`, {
        timeout: 5000
      });
      
      const healthy = response.status === 200 && response.data.status === 'healthy';
      
      plugin.status = healthy ? 'healthy' : 'unhealthy';
      plugin.lastHealthCheck = new Date().toISOString();
      
      return {
        healthy,
        status: response.data.status,
        timestamp: response.data.timestamp
      };
      
    } catch (error) {
      plugin.status = 'unhealthy';
      plugin.lastHealthCheck = new Date().toISOString();
      
      return {
        healthy: false,
        error: error.message
      };
    }
  }

  async callPlugin(pluginId, endpoint, params = {}) {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) {
      throw new Error(`Plugin ${pluginId} not found`);
    }
    
    if (plugin.status !== 'healthy') {
      throw new Error(`Plugin ${pluginId} is not healthy`);
    }
    
    try {
      const url = `${plugin.baseUrl}${plugin.config.endpoints[endpoint]}`;
      console.log(`🔗 Calling plugin: ${pluginId} -> ${endpoint}`);
      
      const response = await axios.post(url, params, {
        timeout: 30000,
        headers: {
          'Content-Type': 'application/json'
        }
      });
      
      return response.data;
      
    } catch (error) {
      console.error(`❌ Plugin call failed: ${pluginId}.${endpoint}`, error.message);
      throw error;
    }
  }

  getPluginByCatalogId(catalogId) {
    for (const [pluginId, plugin] of this.plugins) {
      const stremio = plugin.config.stremio;
      if (stremio.search_catalog_id === catalogId || 
          stremio.discover_catalog_id === catalogId) {
        return pluginId;
      }
    }
    return null;
  }

  getAllPlugins() {
    return Array.from(this.plugins.values());
  }

  getPluginStatus() {
    const status = {};
    for (const [pluginId, plugin] of this.plugins) {
      status[pluginId] = {
        name: plugin.config.name,
        status: plugin.status,
        lastHealthCheck: plugin.lastHealthCheck
      };
    }
    return status;
  }

  startWatching() {
    if (this.watcher) {
      this.watcher.close();
    }
    
    this.watcher = chokidar.watch(
      path.join(this.pluginsDir, '*/plugin.json'),
      { persistent: true }
    );
    
    this.watcher.on('change', (filePath) => {
      const pluginDir = path.basename(path.dirname(filePath));
      console.log(`🔄 Plugin config changed: ${pluginDir}`);
      this.loadPlugin(pluginDir, filePath);
    });
  }

  async shutdown() {
    console.log('🛑 Shutting down Plugin Manager...');
    
    if (this.watcher) {
      this.watcher.close();
    }
    
    this.plugins.clear();
    
    console.log('✅ Plugin Manager shutdown complete');
  }
}

module.exports = PluginManager;