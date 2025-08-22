class StremioAdapter {
  constructor(pluginManager) {
    this.pluginManager = pluginManager;
  }

  async generateManifest(configHash = null) {
    const plugins = this.pluginManager.getAllPlugins();
    const catalogs = [];
    
    // Generate catalogs from all plugins
    for (const plugin of plugins) {
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
    const manifestId = configHash ? `${baseId}.${configHash}` : baseId;

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

  // Generate configuration hash for personalized manifests
  generateConfigHash() {
    try {
      const plugins = this.pluginManager.getAllPlugins();
      const configData = {};
      
      // Collect configuration data from all plugins
      for (const plugin of plugins) {
        const pluginConfig = {
          id: plugin.config.id,
          version: plugin.config.version,
          // Include plugin-specific configuration
          config: this.extractPluginConfig(plugin)
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
  extractPluginConfig(plugin) {
    try {
      const config = {};
      
      // Extract YouTube-specific configuration
      if (plugin.config.id === 'youtube') {
        const youtubeConfig = plugin.config;
        config.search_mode = youtubeConfig.search_mode;
        config.followed_channels = youtubeConfig.followed_channels || [];
        config.api_key_configured = !!youtubeConfig.api_key;
      }
      
      // Add more plugin-specific configurations here
      
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
        limit: 20,
        ...extraParams
      };

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
      background: video.thumbnail || "",
      description: video.description || "",
      
      // Additional metadata
      genres: video.genres || [],
      director: video.channel || [],
      cast: [],
      
      // Video specific info
      runtime: video.duration || "",
      year: video.publishedAt ? new Date(video.publishedAt).getFullYear() : "",
      
      // Ratings and metrics
      rating: video.rating || 0,
      imdbRating: video.viewCount ? Math.min(10, Math.log10(video.viewCount || 1)) : 0,
      
      // Links and references
      website: video.url || "",
      
      // Adult content flag
      adult: video.adult || false
    };

    // Add plugin-specific metadata
    if (video.channel) {
      meta.director = [video.channel];
    }
    
    if (video.tags && Array.isArray(video.tags)) {
      meta.genres = video.tags.slice(0, 5); // Limit to 5 genres
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

    // Add format indicator
    if (stream.format) {
      stremioStream.name = `${stremioStream.name} (${stream.format})`;
    }

    return stremioStream;
  }
}

module.exports = StremioAdapter;