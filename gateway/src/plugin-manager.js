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
    console.log(`🔍 Looking for plugin registry at: ${this.registryFile}`);
    
    try {
      let registryContent = null;
      
      // Try to read local file first
      if (await fs.pathExists(this.registryFile)) {
        console.log(`📄 Local plugins.json found, reading...`);
        try {
          registryContent = await fs.readFile(this.registryFile, 'utf8');
          console.log(`📝 Local file content (first 100 chars):`, registryContent.substring(0, 100));
          
          // Check if it's a valid, non-empty file
          const testParse = JSON.parse(registryContent);
          if (!testParse.plugins || Object.keys(testParse.plugins).length === 0) {
            console.log(`⚠️  Local file is empty or invalid, will try GitHub fallback`);
            registryContent = null;
          } else {
            console.log(`✅ Local file is valid with ${Object.keys(testParse.plugins).length} plugins`);
          }
        } catch (localError) {
          console.log(`❌ Local file is corrupted: ${localError.message}`);
          registryContent = null;
        }
      } else {
        console.log(`📄 Local plugins.json not found`);
      }
      
      // Fallback: Download from GitHub if local file is missing or invalid
      if (!registryContent) {
        console.log(`🌐 Downloading plugins.json from GitHub...`);
        const githubUrl = 'https://raw.githubusercontent.com/mccoy88f/OMG-Roma/refs/heads/main/config/plugins.json';
        
        try {
          const axios = require('axios');
          const response = await axios.get(githubUrl, { timeout: 10000 });
          registryContent = response.data;
          
          // Validate downloaded content
          if (typeof registryContent === 'object') {
            registryContent = JSON.stringify(registryContent, null, 2);
          }
          
          console.log(`✅ Downloaded from GitHub successfully`);
          console.log(`📝 Downloaded content (first 100 chars):`, registryContent.substring(0, 100));
          
          // Save to local file for future use
          try {
            await fs.ensureDir(path.dirname(this.registryFile));
            await fs.writeFile(this.registryFile, registryContent, 'utf8');
            console.log(`💾 Saved GitHub version to local file`);
          } catch (saveError) {
            console.log(`⚠️  Could not save to local file: ${saveError.message}`);
            // Continue anyway, we have the content in memory
          }
          
        } catch (downloadError) {
          const error = `❌ FATAL: Cannot download plugins.json from GitHub: ${downloadError.message}`;
          console.error(error);
          console.error(`🌐 GitHub URL: ${githubUrl}`);
          console.error(`🛑 OMG-Roma cannot start without plugin configuration`);
          throw new Error(error);
        }
      }
      
      // Parse the registry content
      let registry;
      try {
        registry = JSON.parse(registryContent);
      } catch (jsonError) {
        const error = `❌ FATAL: Invalid JSON in plugin registry: ${jsonError.message}`;
        console.error(error);
        console.error(`📄 Content that failed to parse:`, registryContent.substring(0, 200));
        throw new Error(error);
      }
      
      // Validate registry structure
      if (!registry.plugins || typeof registry.plugins !== 'object') {
        const error = `❌ FATAL: Plugin registry missing 'plugins' object`;
        console.error(error);
        console.error(`📋 Expected format: {"plugins": {"youtube": {...}}, "last_updated": "..."}`);
        throw new Error(error);
      }
      
      const pluginCount = Object.keys(registry.plugins).length;
      if (pluginCount === 0) {
        const error = `❌ FATAL: No plugins configured in registry`;
        console.error(error);
        console.error(`📋 OMG-Roma needs at least one plugin to work!`);
        console.error(`🔧 Add plugins to the GitHub repository config/plugins.json`);
        throw new Error(error);
      }
      
      console.log(`✅ Valid plugin registry loaded`);
      console.log(`📊 Found ${pluginCount} plugins configured:`, Object.keys(registry.plugins));
      
      return registry;
      
    } catch (error) {
      console.error(`💥 PLUGIN REGISTRY ERROR: ${error.message}`);
      console.error(`🛑 OMG-Roma cannot start without valid plugin configuration`);
      console.error(`📚 Check repository: https://github.com/mccoy88f/OMG-Roma/blob/main/config/plugins.json`);
      
      // Exit the process - no point in continuing without plugins
      process.exit(1);
    }
  }

  async discoverPlugins() {
    console.log('🔍 Discovering plugins...');
    
    try {
      // Load plugins from registry instead of filesystem scan
      const registry = await this.loadPluginRegistry();
      
      for (const [pluginId, pluginInfo] of Object.entries(registry.plugins || {})) {
        console.log(`🔍 Processing plugin: ${pluginId}`);
        await this.loadPluginFromRegistry(pluginId, pluginInfo);
      }
      
      // Wait for plugins to be ready
      await this.waitForPluginsReady();
      
      // Additional delay to ensure plugins are fully ready
      console.log('⏳ Additional delay to ensure plugins are fully ready...');
      await new Promise(resolve => setTimeout(resolve, 5000));
      
      console.log(`✅ Discovered ${this.plugins.size} plugins`);
      
    } catch (error) {
      console.error('❌ Error discovering plugins:', error);
    }
  }

  async loadPluginFromRegistry(pluginId, pluginInfo) {
    try {
      console.log(`📦 Loading plugin from registry: ${pluginId}`);
      console.log(`🔗 Plugin info:`, pluginInfo);
      
      // Use plugin config from registry if available
      if (pluginInfo.config) {
        console.log(`✅ Using plugin config from registry for ${pluginId}`);
        const plugin = {
          id: pluginId,
          url: pluginInfo.url || `http://${pluginId}-plugin:${pluginInfo.port}`,
          config: pluginInfo.config,
          manifestEnabled: pluginInfo.manifestEnabled !== false,
          status: 'registered'
        };
        
        this.plugins.set(pluginId, plugin);
        console.log(`✅ Plugin ${pluginId} loaded from registry`);
        return true;
      }
      
      // Fallback: try to get plugin config from container
      const baseUrl = pluginInfo.url || `http://${pluginId}-plugin:${pluginInfo.port}`;
      console.log(`🌐 Trying to connect to: ${baseUrl}`);
      
      // Try to get plugin.json from the container via HTTP with retry
      let pluginConfig;
      let retryCount = 0;
      const maxRetries = 3;
      
      while (retryCount < maxRetries) {
        try {
          console.log(`📄 Fetching plugin config from ${baseUrl}/plugin.json (attempt ${retryCount + 1}/${maxRetries})`);
          const response = await axios.get(`${baseUrl}/plugin.json`, { timeout: 10000 });
          pluginConfig = response.data;
          console.log(`✅ Retrieved plugin config for ${pluginId} via HTTP`);
          break;
        } catch (httpError) {
          retryCount++;
          console.error(`❌ HTTP error for ${pluginId} (attempt ${retryCount}/${maxRetries}):`, httpError.message);
          
          if (retryCount >= maxRetries) {
            // Fallback: create basic config from registry info
            console.log(`⚠️  Could not fetch plugin.json via HTTP after ${maxRetries} attempts, using registry info`);
            pluginConfig = {
              id: pluginId,
              name: pluginInfo.name || pluginId.charAt(0).toUpperCase() + pluginId.slice(1),
              version: pluginInfo.version || "1.0.0",
              port: pluginInfo.port,
              endpoints: {
                search: "/search",
                discover: "/discover", 
                meta: "/meta",
                stream: "/stream",
                config: "/config"
              },
              stremio: {
                search_catalog_name: `Search ${pluginId}`,
                search_catalog_id: `${pluginId}_search`,
                discover_catalog_name: `${pluginId} Discover`,
                discover_catalog_id: `${pluginId}_channels`
              }
            };
          } else {
            // Wait before retry
            await new Promise(resolve => setTimeout(resolve, 2000));
          }
        }
      }
      
      console.log(`🔧 Plugin config for ${pluginId}:`, JSON.stringify(pluginConfig, null, 2));
      
      // Validate plugin config
      if (!this.validatePluginConfig(pluginConfig)) {
        console.error(`❌ Invalid plugin config for ${pluginId}`);
        return false;
      }
      
      // Add plugin to registry
      this.plugins.set(pluginId, {
        id: pluginId,
        url: baseUrl,
        config: pluginConfig,
        manifestEnabled: pluginInfo.manifestEnabled !== false,
        status: 'loaded'
      });
      
      console.log(`✅ Plugin ${pluginId} loaded successfully`);
      return true;
      
    } catch (error) {
      console.error(`❌ Error loading plugin ${pluginId}:`, error.message);
      
      // Add plugin with error status
      this.plugins.set(pluginId, {
        id: pluginId,
        url: pluginInfo.url || `http://${pluginId}-plugin:${pluginInfo.port}`,
        config: {
          id: pluginId,
          name: pluginId,
          version: '1.0.0',
          description: `Plugin ${pluginId} (error loading)`,
          stremio: {
            search_catalog_name: `Search ${pluginId}`,
            search_catalog_id: `${pluginId}_search`,
            discover_catalog_name: `${pluginId} Discover`,
            discover_catalog_id: `${pluginId}_channels`
          }
        },
        manifestEnabled: false,
        status: 'error',
        error: error.message
      });
      
      return false;
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
        baseUrl: `http://omg-${pluginId}-plugin:${pluginConfig.port}`,
        status: 'discovered',
        lastHealthCheck: null,
        manifestEnabled: true // Default: plugin is enabled in manifest
      };
      
             // Ensure required endpoints exist
       if (!pluginConfig.endpoints.config) {
         pluginConfig.endpoints.config = "/config";
       }
       if (!pluginConfig.endpoints['config/schema']) {
         pluginConfig.endpoints['config/schema'] = "/config/schema";
       }
       if (!pluginConfig.endpoints.test) {
         pluginConfig.endpoints.test = "/test";
       }
      
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

  async waitForPluginsReady(timeout = 60000) {
    console.log('⏳ Waiting for plugins to be ready...');
    
    const startTime = Date.now();
    const checkInterval = 3000;
    
    while (Date.now() - startTime < timeout) {
      let allReady = true;
      
      for (const [pluginId, plugin] of this.plugins) {
        try {
          console.log(`🔍 Checking health of plugin: ${pluginId}`);
          const healthCheck = await this.checkPluginHealth(pluginId);
          if (!healthCheck.healthy) {
            console.log(`⚠️  Plugin ${pluginId} not ready yet:`, healthCheck.error || 'Health check failed');
            allReady = false;
          } else {
            console.log(`✅ Plugin ${pluginId} is healthy`);
          }
        } catch (error) {
          console.log(`❌ Plugin ${pluginId} health check error:`, error.message);
          allReady = false;
        }
      }
      
      if (allReady) {
        console.log('✅ All plugins are ready');
        return true;
      }
      
      console.log(`⏳ Waiting ${checkInterval/1000}s before next health check...`);
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
      const baseUrl = plugin.url || plugin.baseUrl;
      console.log(`🔍 Health check for ${pluginId} at ${baseUrl}/health`);
      const response = await axios.get(`${baseUrl}/health`, {
        timeout: 10000
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
      
      console.log(`❌ Health check failed for ${pluginId}:`, error.message);
      
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
    
    // Allow calls to plugins in various states (not just healthy)
    if (plugin.status === 'error') {
      throw new Error(`Plugin ${pluginId} has errors: ${plugin.error}`);
    }
    
    try {
      const baseUrl = plugin.url || plugin.baseUrl;
      const endpointPath = plugin.config.endpoints[endpoint];
      
      if (!endpointPath) {
        throw new Error(`Endpoint ${endpoint} not found in plugin ${pluginId}`);
      }
      
      const url = `${baseUrl}${endpointPath}`;
      console.log(`🔗 Calling plugin: ${pluginId} -> ${endpoint} at ${url}`);
      
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
        url: plugin.url || plugin.baseUrl,
        manifestEnabled: plugin.manifestEnabled
      };
      
      if (plugin.error) {
        status[pluginId].error = plugin.error;
      }
    }
    return status;
  }

  async getPluginConfig(pluginId) {
    try {
      const plugin = this.plugins.get(pluginId);
      if (!plugin) {
        throw new Error(`Plugin ${pluginId} not found`);
      }

      const response = await this.callPlugin(pluginId, 'config');
      return response;
    } catch (error) {
      console.error(`❌ Error getting plugin config for ${pluginId}:`, error);
      throw error;
    }
  }

  async getPluginConfigSchema(pluginId) {
    try {
      const plugin = this.plugins.get(pluginId);
      if (!plugin) {
        throw new Error(`Plugin ${pluginId} not found`);
      }

      const response = await this.callPlugin(pluginId, 'config/schema');
      return response;
    } catch (error) {
      console.error(`❌ Error getting plugin config schema for ${pluginId}:`, error);
      // Fallback to plugin.json config
      const plugin = this.plugins.get(pluginId);
      if (plugin) {
        return {
          success: true,
          schema: plugin.config.config_schema || {}
        };
      } else {
        return {
          success: false,
          error: 'Plugin not found for fallback'
        };
      }
    }
  }

  async testPlugin(pluginId, testParams) {
    try {
      const plugin = this.plugins.get(pluginId);
      if (!plugin) {
        throw new Error(`Plugin ${pluginId} not found`);
      }

      const response = await this.callPlugin(pluginId, 'test', testParams);
      return response;
    } catch (error) {
      console.error(`❌ Error testing plugin ${pluginId}:`, error);
      throw error;
    }
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
