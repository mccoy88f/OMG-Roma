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

        res.json({
          success: true,
          pluginId,
          message: 'Configuration updated successfully',
          config: response.config || {}
        });

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
        
        const manifest = await stremioAdapter.generateManifest();
        
        res.json({
          success: true,
          manifest,
          catalogCount: manifest.catalogs.length,
          manifestUrl: `${req.protocol}://${req.get('host')}/manifest.json`
        });

      } catch (error) {
        console.error('❌ Error generating manifest:', error);
        res.status(500).json({ 
          success: false, 
          error: 'Failed to generate manifest' 
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