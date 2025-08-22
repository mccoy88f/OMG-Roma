const express = require('express');
const fs = require('fs-extra');
const path = require('path');

class WebUI {
  constructor(pluginManager) {
    this.pluginManager = pluginManager;
    this.router = express.Router();
    this.setupRoutes();
  }

  setupRoutes() {
    // Get all plugins status
    this.router.get('/plugins', (req, res) => {
      try {
        const plugins = this.pluginManager.getAllPlugins();
        const status = this.pluginManager.getPluginStatus();
        
        const pluginsData = plugins.map(plugin => ({
          id: plugin.id,
          name: plugin.config.name,
          version: plugin.config.version,
          description: plugin.config.description,
          status: status[plugin.id]?.status || 'unknown',
          lastHealthCheck: status[plugin.id]?.lastHealthCheck,
          manifestEnabled: plugin.manifestEnabled !== false, // Default to true if not set
          stremio: plugin.config.stremio,
          features: plugin.config.features || {},
          content_types: plugin.config.content_types || {}
        }));

        res.json({
          success: true,
          plugins: pluginsData,
          total: pluginsData.length
        });

      } catch (error) {
        console.error('❌ Error getting plugins:', error);
        res.status(500).json({ 
          success: false, 
          error: 'Failed to get plugins',
          plugins: []
        });
      }
    });

    // Get specific plugin configuration
    this.router.get('/plugins/:pluginId/config', async (req, res) => {
      try {
        const { pluginId } = req.params;
        
        const plugin = this.pluginManager.plugins.get(pluginId);
        if (!plugin) {
          return res.status(404).json({ 
            success: false, 
            error: 'Plugin not found' 
          });
        }

        // Get config from plugin
        const configResponse = await this.pluginManager.callPlugin(pluginId, 'config');
        
        res.json({
          success: true,
          pluginId,
          config: configResponse,
          schema: plugin.config.config_schema || {}
        });

      } catch (error) {
        console.error('❌ Error getting plugin config:', error);
        res.status(500).json({ 
          success: false, 
          error: 'Failed to get plugin configuration' 
        });
      }
    });

    // Update plugin configuration
    this.router.post('/plugins/:pluginId/config', async (req, res) => {
      try {
        const { pluginId } = req.params;
        const newConfig = req.body;

        const plugin = this.pluginManager.plugins.get(pluginId);
        if (!plugin) {
          return res.status(404).json({ 
            success: false, 
            error: 'Plugin not found' 
          });
        }

        // Send config update to plugin
        const response = await this.pluginManager.callPlugin(pluginId, 'config', newConfig);

        // Regenerate manifest after configuration change
        try {
          const StremioAdapter = require('./stremio-adapter');
          const stremioAdapter = new StremioAdapter(this.pluginManager);
          
          const manifestUpdate = await stremioAdapter.regenerateManifestForPlugin(pluginId);
          
          // Generate new manifest URL
          const baseUrl = `${req.protocol}://${req.get('host')}`;
          const newManifestUrl = `${baseUrl}/manifest.json?config=${manifestUpdate.configHash}`;
          
          res.json({
            success: true,
            pluginId,
            message: 'Configuration updated successfully',
            config: response.config || {},
            manifest: {
              updated: true,
              newUrl: newManifestUrl,
              configHash: manifestUpdate.configHash
            }
          });
          
        } catch (manifestError) {
          console.warn('⚠️  Could not regenerate manifest:', manifestError.message);
          // Still return success for config update
          res.json({
            success: true,
            pluginId,
            message: 'Configuration updated successfully (manifest update failed)',
            config: response.config || {}
          });
        }

      } catch (error) {
        console.error('❌ Error updating plugin config:', error);
        res.status(500).json({ 
          success: false, 
          error: 'Failed to update plugin configuration',
          details: error.message
        });
      }
    });

    // Health check for specific plugin
    this.router.get('/plugins/:pluginId/health', async (req, res) => {
      try {
        const { pluginId } = req.params;
        
        const healthCheck = await this.pluginManager.checkPluginHealth(pluginId);
        
        res.json({
          success: true,
          pluginId,
          health: healthCheck
        });

      } catch (error) {
        console.error('❌ Error checking plugin health:', error);
        res.status(500).json({ 
          success: false, 
          error: 'Failed to check plugin health' 
        });
      }
    });

    // Global addon status
    this.router.get('/status', (req, res) => {
      try {
        const plugins = this.pluginManager.getAllPlugins();
        const status = this.pluginManager.getPluginStatus();
        
        const totalPlugins = plugins.length;
        const healthyPlugins = Object.values(status).filter(s => s.status === 'healthy').length;
        
        res.json({
          success: true,
          addon: {
            name: 'OMG-Roma',
            version: '1.0.0',
            status: healthyPlugins === totalPlugins ? 'healthy' : 'partial',
            uptime: process.uptime()
          },
          plugins: {
            total: totalPlugins,
            healthy: healthyPlugins,
            unhealthy: totalPlugins - healthyPlugins
          },
          system: {
            memory: process.memoryUsage(),
            platform: process.platform,
            nodeVersion: process.version
          }
        });

      } catch (error) {
        console.error('❌ Error getting system status:', error);
        res.status(500).json({ 
          success: false, 
          error: 'Failed to get system status' 
        });
      }
    });

    // Get manifest information
    this.router.get('/manifest', async (req, res) => {
      try {
        const StremioAdapter = require('./stremio-adapter');
        const stremioAdapter = new StremioAdapter(this.pluginManager);
        
        // Check if force regeneration is requested
        const { force } = req.query;
        
        if (force === 'true') {
          // Clear cache and regenerate
          stremioAdapter.clearManifestCache();
          console.log('🔄 Force manifest regeneration requested');
        }
        
        // Generate configuration hash for personalized manifest
        const configHash = await stremioAdapter.generateConfigHash();
        const manifest = await stremioAdapter.generateManifest(configHash);
        
        // Generate personalized manifest URL
        const baseUrl = `${req.protocol}://${req.get('host')}`;
        const manifestUrl = configHash 
          ? `${baseUrl}/manifest.json?config=${configHash}`
          : `${baseUrl}/manifest.json`;
        
        res.json({
          success: true,
          manifest,
          catalogCount: manifest.catalogs.length,
          manifestUrl,
          configHash,
          isPersonalized: !!configHash,
          regenerated: force === 'true'
        });

      } catch (error) {
        console.error('❌ Error generating manifest:', error);
        res.status(500).json({ 
          success: false, 
          error: 'Failed to generate manifest' 
        });
      }
    });

    // Force regenerate manifest for all plugins
    this.router.post('/manifest/regenerate', async (req, res) => {
      try {
        const StremioAdapter = require('./stremio-adapter');
        const stremioAdapter = new StremioAdapter(this.pluginManager);
        
        // Clear all caches
        stremioAdapter.clearManifestCache();
        
        // Generate new manifest
        const configHash = await stremioAdapter.generateConfigHash();
        const manifest = await stremioAdapter.generateManifest(configHash);
        
        // Generate new manifest URL
        const baseUrl = `${req.protocol}://${req.get('host')}`;
        const manifestUrl = configHash 
          ? `${baseUrl}/manifest.json?config=${configHash}`
          : `${baseUrl}/manifest.json`;
        
        res.json({
          success: true,
          message: 'Manifest regenerated successfully',
          manifest,
          manifestUrl,
          configHash,
          isPersonalized: !!configHash
        });

      } catch (error) {
        console.error('❌ Error regenerating manifest:', error);
        res.status(500).json({ 
          success: false, 
          error: 'Failed to regenerate manifest' 
        });
      }
    });

    // Toggle plugin in manifest
    this.router.post('/manifest/plugins', async (req, res) => {
      try {
        const { pluginId, enabled } = req.body;
        
        if (!pluginId || typeof enabled !== 'boolean') {
          return res.status(400).json({
            success: false,
            error: 'Invalid request: pluginId and enabled required'
          });
        }

        const plugin = this.pluginManager.plugins.get(pluginId);
        if (!plugin) {
          return res.status(404).json({
            success: false,
            error: 'Plugin not found'
          });
        }

        // Update plugin manifest status
        plugin.manifestEnabled = enabled;
        
        // Regenerate manifest with new plugin selection
        const StremioAdapter = require('./stremio-adapter');
        const stremioAdapter = new StremioAdapter(this.pluginManager);
        
        const manifestUpdate = await stremioAdapter.regenerateManifestForPlugin(pluginId);
        
        // Generate new manifest URL
        const baseUrl = `${req.protocol}://${req.get('host')}`;
        const newManifestUrl = `${baseUrl}/manifest.json?config=${manifestUpdate.configHash}`;
        
        res.json({
          success: true,
          message: `Plugin ${pluginId} ${enabled ? 'enabled' : 'disabled'} in manifest`,
          manifest: {
            updated: true,
            newUrl: newManifestUrl,
            configHash: manifestUpdate.configHash
          }
        });

      } catch (error) {
        console.error('❌ Error toggling plugin in manifest:', error);
        res.status(500).json({
          success: false,
          error: 'Failed to toggle plugin in manifest'
        });
      }
    });

    // Save complete plugin selection
    this.router.post('/manifest/plugins/selection', async (req, res) => {
      try {
        const { plugins } = req.body;
        
        if (!plugins || typeof plugins !== 'object') {
          return res.status(400).json({
            success: false,
            error: 'Invalid request: plugins object required'
          });
        }

        // Update all plugin manifest statuses
        for (const [pluginId, enabled] of Object.entries(plugins)) {
          const plugin = this.pluginManager.plugins.get(pluginId);
          if (plugin) {
            plugin.manifestEnabled = enabled;
            console.log(`🔧 Plugin ${pluginId} manifest status: ${enabled ? 'enabled' : 'disabled'}`);
          }
        }
        
        // Regenerate manifest with new plugin selection
        const StremioAdapter = require('./stremio-adapter');
        const stremioAdapter = new StremioAdapter(this.pluginManager);
        
        const configHash = await stremioAdapter.generateConfigHash();
        const manifest = await stremioAdapter.generateManifest(configHash);
        
        // Generate new manifest URL
        const baseUrl = `${req.protocol}://${req.get('host')}`;
        const newManifestUrl = `${baseUrl}/manifest.json?config=${configHash}`;
        
        res.json({
          success: true,
          message: 'Plugin selection saved successfully',
          manifest: {
            updated: true,
            newUrl: newManifestUrl,
            configHash: configHash
          }
        });

      } catch (error) {
        console.error('❌ Error saving plugin selection:', error);
        res.status(500).json({
          success: false,
          error: 'Failed to save plugin selection'
        });
      }
    });

    // Test plugin functionality
    this.router.post('/plugins/:pluginId/test', async (req, res) => {
      try {
        const { pluginId } = req.params;
        const { testType = 'search', query = 'test' } = req.body;

        const plugin = this.pluginManager.plugins.get(pluginId);
        if (!plugin) {
          return res.status(404).json({ 
            success: false, 
            error: 'Plugin not found' 
          });
        }

        let testResult;
        const startTime = Date.now();

        switch (testType) {
          case 'search':
            testResult = await this.pluginManager.callPlugin(pluginId, 'search', {
              search: query,
              limit: 5
            });
            break;
            
          case 'discover':
            testResult = await this.pluginManager.callPlugin(pluginId, 'discover', {
              limit: 5
            });
            break;
            
          default:
            throw new Error(`Unknown test type: ${testType}`);
        }

        const duration = Date.now() - startTime;

        res.json({
          success: true,
          pluginId,
          testType,
          duration: `${duration}ms`,
          result: {
            videoCount: testResult.videos?.length || 0,
            hasMore: testResult.hasMore || false,
            sampleVideo: testResult.videos?.[0] || null
          }
        });

      } catch (error) {
        console.error('❌ Error testing plugin:', error);
        res.status(500).json({ 
          success: false, 
          error: 'Plugin test failed',
          details: error.message
        });
      }
    });

    // Get plugin logs (if available)
    this.router.get('/plugins/:pluginId/logs', (req, res) => {
      // This would require log aggregation setup
      res.json({
        success: false,
        error: 'Log viewing not implemented yet',
        message: 'Use docker-compose logs -f to view plugin logs'
      });
    });
  }

  getRouter() {
    return this.router;
  }
}

module.exports = WebUI;