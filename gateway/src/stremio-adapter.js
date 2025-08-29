class StremioAdapter {
  constructor(pluginManager) {
    this.pluginManager = pluginManager;
    this.manifestCache = new Map(); // Cache per manifest personalizzati
    this.configCache = new Map();   // Cache per configurazioni plugin
  }

  async generateManifest(configParams = null) {
    const plugins = this.pluginManager.getAllPlugins();
    const catalogs = [];
    
    // Parse configuration parameters if provided
    let pluginConfigs = {};
    if (configParams) {
      try {
        // Parse query string parameters
        const params = new URLSearchParams(configParams);
        for (const [key, value] of params) {
          pluginConfigs[key] = value;
        }
        console.log(`🔧 Parsed plugin configs:`, Object.keys(pluginConfigs));
      } catch (error) {
        console.warn('⚠️  Failed to parse config params:', error.message);
      }
    }
    
    // Generate catalogs from enabled plugins only
    for (const plugin of plugins) {
      // Skip disabled plugins
      if (plugin.manifestEnabled === false) {
        console.log(`⏸️  Skipping disabled plugin: ${plugin.id}`);
        continue;
      }
      
      const stremio = plugin.config.stremio;
      
      // Search catalog
      if (stremio.search_catalog_name && stremio.search_catalog_id) {
        catalogs.push({
          type: "channel",
          id: stremio.search_catalog_id,
          name: stremio.search_catalog_name,
          extra: [
            {
              name: "search",
              isRequired: false
            },
            {
              name: "skip",
              isRequired: false
            }
          ]
        });
      }
      
      // Discover catalog
      if (stremio.discover_catalog_name && stremio.discover_catalog_id) {
        catalogs.push({
          type: "channel", 
          id: stremio.discover_catalog_id,
          name: stremio.discover_catalog_name,
          extra: [
            {
              name: "skip",
              isRequired: false
            }
          ]
        });
      }
    }

    // Generate unique manifest ID based on configuration
    const baseId = "omg.roma.addon";
    const manifestId = configParams ? `${baseId}.${this.hashConfig(configParams)}` : baseId;

    const manifest = {
      id: manifestId,
      version: "1.0.0",
      name: "OMG-Roma",
      description: "OMG-Roma - Addon modulare per streaming multi-piattaforma",
      logo: "https://via.placeholder.com/256x256/FF6B6B/FFFFFF?text=OMG",
      background: "https://via.placeholder.com/1920x1080/4ECDC4/FFFFFF?text=OMG-Roma",
      
      types: ["channel"],
      idPrefixes: plugins.map(p => p.config.id),
      
      catalogs: catalogs,
      
      resources: [
        {
          name: "catalog",
          types: ["channel"],
          idPrefixes: plugins.map(p => p.config.id)
        },
        {
          name: "meta", 
          types: ["channel"],
          idPrefixes: plugins.map(p => p.config.id)
        },
        {
          name: "stream",
          types: ["channel"], 
          idPrefixes: plugins.map(p => p.config.id)
        }
      ],
      
      behaviorHints: {
        adult: false,
        p2p: false,
        configurable: true,
        configurationRequired: false
      }
    };

    return manifest;
  }

  hashConfig(configString) {
    // Simple hash function for configuration string
    let hash = 0;
    if (configString.length === 0) return hash.toString();
    
    for (let i = 0; i < configString.length; i++) {
      const char = configString.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    
    return Math.abs(hash).toString(36);
  }

  // Generate configuration hash for personalized manifests
  async generateConfigHash() {
    try {
      const plugins = this.pluginManager.getAllPlugins();
      const configData = {};
      
      // Collect configuration data from enabled plugins only
      for (const plugin of plugins) {
        // Skip disabled plugins
        if (plugin.manifestEnabled === false) {
          console.log(`⏸️  Skipping disabled plugin in config hash: ${plugin.id}`);
          continue;
        }
        
        const pluginConfig = {
          id: plugin.config.id,
          version: plugin.config.version,
          // Include plugin-specific configuration
          config: await this.extractPluginConfig(plugin)
        };
        configData[plugin.config.id] = pluginConfig;
      }
      
      // Create a hash from configuration data
      const configString = JSON.stringify(configData, Object.keys(configData).sort());
      const hash = this.simpleHash(configString);
      
      return hash;
    } catch (error) {
      console.error('❌ Error generating config hash:', error);
      return null;
    }
  }

  // Extract relevant configuration from plugin
  async extractPluginConfig(plugin) {
    try {
      const config = {};
      
      // Get current plugin configuration from the plugin itself
      try {
        const currentConfig = await this.pluginManager.callPlugin(plugin.config.id, 'config');
        
        // Extract YouTube-specific configuration
        if (plugin.config.id === 'youtube') {
          config.search_mode = currentConfig.search_mode || 'hybrid';
          config.followed_channels = currentConfig.followed_channels || [];
          config.api_key_configured = !!currentConfig.api_key;
          config.video_limit = currentConfig.video_limit || 20;
          config.quality_preference = currentConfig.quality_preference || 'best';
        }
        
        // Add more plugin-specific configurations here
        
      } catch (configError) {
        console.warn(`⚠️  Could not get current config for ${plugin.config.id}:`, configError.message);
        // Fallback to plugin.json config
        if (plugin.config.id === 'youtube') {
          config.search_mode = 'hybrid';
          config.followed_channels = [];
          config.api_key_configured = false;
        }
      }
      
      return config;
    } catch (error) {
      console.error('❌ Error extracting plugin config:', error);
      return {};
    }
  }

  // Simple hash function for configuration
  simpleHash(str) {
    let hash = 0;
    if (str.length === 0) return hash.toString();
    
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    
    return Math.abs(hash).toString(36); // Convert to base36 for shorter strings
  }

  // Clear manifest cache when configuration changes
  clearManifestCache() {
    this.manifestCache.clear();
    this.configCache.clear();
    console.log('🧹 Manifest cache cleared - configuration changed');
  }

  // Force regenerate manifest for a specific plugin
  async regenerateManifestForPlugin(pluginId) {
    try {
      // Clear cache for this plugin
      this.configCache.delete(pluginId);
      
      // Generate new config hash
      const newConfigHash = await this.generateConfigHash();
      
      // Generate new manifest
      const newManifest = await this.generateManifest(newConfigHash);
      
      // Cache the new manifest
      this.manifestCache.set(newConfigHash, newManifest);
      
      console.log(`🔄 Manifest regenerated for ${pluginId} with hash: ${newConfigHash}`);
      
      return {
        configHash: newConfigHash,
        manifest: newManifest
      };
      
    } catch (error) {
      console.error(`❌ Error regenerating manifest for ${pluginId}:`, error);
      throw error;
    }
  }

  async handleMetaRequest(id) {
    try {
      // Estrae pluginId e videoId dal formato pluginId:videoId
      const [pluginId, videoId] = id.split(':', 2);
      
      if (!pluginId || !videoId) {
        throw new Error(`Invalid video ID format: ${id}`);
      }
      
      console.log(`🔍 Meta request for ${pluginId}:${videoId}`);
      
      // Chiama il plugin per ottenere i meta
      const result = await this.pluginManager.callPlugin(pluginId, 'meta', { videoId });
      
      // Converte i meta nel formato Stremio
      return { meta: this.convertToStremioMeta(result.video, pluginId) };
      
    } catch (error) {
      console.error(`❌ Meta request error:`, error.message);
      // Fallback: genera meta di base
      return { meta: this.generateFallbackMeta(id) };
    }
  }

  async handleStreamRequest(id) {
    try {
      // Estrae pluginId e videoId dal formato pluginId:videoId
      const [pluginId, videoId] = id.split(':', 2);
      
      if (!pluginId || !videoId) {
        throw new Error(`Invalid video ID format: ${id}`);
      }
      
      console.log(`🎬 Stream request for ${pluginId}:${videoId}`);
      
      // Chiama il plugin per ottenere gli stream
      const result = await this.pluginManager.callPlugin(pluginId, 'stream', { videoId });
      
      // Converte gli stream nel formato Stremio
      const streams = result.streams.map(stream => this.convertToStremioStream(stream));
      
      return { streams };
      
    } catch (error) {
      console.error(`❌ Stream request error:`, error.message);
      // Fallback: genera stream di base
      return { streams: this.generateFallbackStreams(id) };
    }
  }

  async handleCatalogRequest(catalogId, extraParams) {
    try {
      const pluginId = this.pluginManager.getPluginByCatalogId(catalogId);
      
      if (!pluginId) {
        console.error(`❌ No plugin found for catalog: ${catalogId}`);
        return { metas: [] };
      }

      const plugin = this.pluginManager.plugins.get(pluginId);
      const isSearchCatalog = plugin.config.stremio.search_catalog_id === catalogId;
      const isDiscoverCatalog = plugin.config.stremio.discover_catalog_id === catalogId;

      let endpoint;
      if (isSearchCatalog) {
        endpoint = 'search';
      } else if (isDiscoverCatalog) {
        endpoint = 'discover';
      } else {
        throw new Error(`Unknown catalog type for ${catalogId}`);
      }

      // Prepare request parameters
      const requestParams = {
        catalogId,
        search: extraParams.search || '',
        skip: parseInt(extraParams.skip) || 0,
        limit: 20
      };
      
      // Add plugin-specific configuration parameters
      for (const [key, value] of Object.entries(extraParams)) {
        if (key.startsWith(`${pluginId}_`)) {
          const configKey = key.replace(`${pluginId}_`, '');
          requestParams[configKey] = value;
        }
      }

      console.log(`🔍 ${endpoint} request to ${pluginId}:`, requestParams);

      const result = await this.pluginManager.callPlugin(pluginId, endpoint, requestParams);
      
      // Convert plugin response to Stremio format
      const metas = this.convertToStremioMetas(result.videos || [], pluginId);
      
      return { 
        metas,
        hasMore: result.hasMore || false
      };
      
    } catch (error) {
      console.error('❌ Catalog request failed:', error);
      return { metas: [] };
    }
  }

  async handleMetaRequest(id) {
    try {
      // Extract plugin ID from meta ID (format: pluginId:videoId)
      const [pluginId, videoId] = id.split(':', 2);
      
      if (!pluginId || !videoId) {
        throw new Error(`Invalid meta ID format: ${id}`);
      }

      const result = await this.pluginManager.callPlugin(pluginId, 'meta', { 
        videoId: videoId 
      });

      if (!result.video) {
        throw new Error(`No video found for ID: ${id}`);
      }

      const meta = this.convertToStremioMeta(result.video, pluginId);
      
      return { meta };
      
    } catch (error) {
      console.error('❌ Meta request failed:', error);
      return { meta: null };
    }
  }

  async handleStreamRequest(id) {
    try {
      // Extract plugin ID from stream ID (format: pluginId:videoId)
      const [pluginId, videoId] = id.split(':', 2);
      
      if (!pluginId || !videoId) {
        throw new Error(`Invalid stream ID format: ${id}`);
      }

      console.log(`🎬 Getting streams for ${pluginId}:${videoId}`);

      const result = await this.pluginManager.callPlugin(pluginId, 'stream', { 
        videoId: videoId 
      });

      if (!result.streams || result.streams.length === 0) {
        console.warn(`⚠️  No streams found for ${id}`);
        return { streams: [] };
      }

      // Convert plugin streams to Stremio format
      const streams = result.streams.map(stream => this.convertToStremioStream(stream));
      
      console.log(`✅ Found ${streams.length} streams for ${id}`);
      
      return { streams };
      
    } catch (error) {
      console.error('❌ Stream request failed:', error);
      return { streams: [] };
    }
  }

  convertToStremioMetas(videos, pluginId) {
    return videos.map(video => this.convertToStremioMeta(video, pluginId));
  }

  convertToStremioMeta(video, pluginId) {
    // Generate consistent ID format
    const id = `${pluginId}:${video.id}`;
    
    const meta = {
      id: id,
      type: "channel",
      name: video.title || "Unknown Title",
      poster: video.thumbnail || "",
      posterShape: "landscape",
      background: video.thumbnail || "",
      logo: video.channelThumbnail || video.thumbnail || "",
      description: video.description || "",
      
      // Additional metadata
      genre: video.genres || [pluginId],
      director: video.channel || video.channelTitle || pluginId,
      cast: video.channel ? [video.channel] : [pluginId],
      country: video.country || "Unknown",
      language: video.language || "en",
      subtitles: video.subtitles || [],
      
      // Video specific info
      runtime: video.duration || "",
      releaseInfo: video.duration || pluginId,
      year: video.publishedAt ? new Date(video.publishedAt).getFullYear() : new Date().getFullYear(),
      released: video.publishedAt || new Date().toISOString().split('T')[0],
      
      // Ratings and metrics
      rating: video.rating || 0,
      imdbRating: video.viewCount ? Math.min(10, Math.log10(video.viewCount || 1)) : 0,
      
      // Links and references
      website: video.url || "",
      links: [
        {
          name: pluginId,
          category: "watch",
          url: video.url || `https://${pluginId}.com/watch?v=${video.id}`
        }
      ],
      
      // Adult content flag
      adult: video.adult || false
    };

    // Add plugin-specific metadata
    if (video.channel) {
      meta.director = video.channel;
    }
    
    if (video.tags && Array.isArray(video.tags)) {
      meta.genre = video.tags.slice(0, 5); // Limit to 5 genres
    }

    return meta;
  }

  convertToStremioStream(stream) {
    const stremioStream = {
      name: stream.name || stream.title || "Unknown Stream",
      title: stream.title || stream.name || "",
      url: stream.url,
      
      // Quality and format info
      quality: stream.quality || "",
      format: stream.format || "mp4",
      
      // Behavioral hints
      behaviorHints: {
        bingeGroup: stream.bingeGroup || "default",
        countryWhitelist: stream.countryWhitelist || undefined,
        notWebReady: stream.notWebReady || false
      }
    };

    // Add quality indicator to name if available
    if (stream.quality) {
      stremioStream.name = `${stremioStream.name} - ${stream.quality}`;
    }

    // Add format indicator if available
    if (stream.format) {
      stremioStream.name = `${stremioStream.name} (${stream.format.toUpperCase()})`;
    }

    return stremioStream;
  }

  generateFallbackMeta(id) {
    const [pluginId, videoId] = id.split(':', 2);
    return {
      id: id,
      type: "channel",
      name: `Video ${videoId}`,
      poster: "",
      posterShape: "landscape",
      background: "",
      logo: "",
      description: `Video from ${pluginId}`,
      genre: [pluginId],
      director: pluginId,
      cast: [pluginId],
      country: "Unknown",
      language: "en",
      subtitles: [],
      runtime: "",
      releaseInfo: pluginId,
      year: new Date().getFullYear(),
      released: new Date().toISOString().split('T')[0],
      rating: 0,
      imdbRating: 0,
      website: "",
      links: [
        {
          name: pluginId,
          category: "watch",
          url: `https://${pluginId}.com/watch?v=${videoId}`
        }
      ],
      adult: false
    };
  }

  generateFallbackStreams(id) {
    const [pluginId, videoId] = id.split(':', 2);
    return [
      {
        name: `Stream ${videoId} - Best Quality`,
        title: `Best Quality Stream`,
        url: `http://localhost:3100/proxy-best/channel/${id}`,
        quality: "best",
        format: "mp4",
        behaviorHints: {
          bingeGroup: "default",
          notWebReady: false
        }
      }
    ];
  }
}

module.exports = StremioAdapter;