const fs = require('fs-extra');
const path = require('path');

class ConfigManager {
  constructor(configFile) {
    this.configFile = configFile;
    this.config = {};
    this.defaults = {
      api_key: '',
      search_mode: 'hybrid',
      followed_channels: [],
      video_limit: 20,
      quality_preference: 'best',
      adult_content: false
    };
  }

  async load() {
    try {
      console.log(`📋 Loading config from: ${this.configFile}`);
      
      if (await fs.pathExists(this.configFile)) {
        const data = await fs.readJson(this.configFile);
        this.config = { ...this.defaults, ...data };
        console.log('✅ Configuration loaded successfully');
      } else {
        console.log('📝 No config file found, using defaults');
        this.config = { ...this.defaults };
        await this.save();
      }
      
      this.validateConfig();
      
    } catch (error) {
      console.error('❌ Error loading configuration:', error);
      console.log('🔄 Using default configuration');
      this.config = { ...this.defaults };
    }
  }

  async save() {
    try {
      // Ensure directory exists
      const configDir = path.dirname(this.configFile);
      await fs.ensureDir(configDir);
      
      // Add metadata
      const configWithMeta = {
        ...this.config,
        _metadata: {
          last_updated: new Date().toISOString(),
          version: '1.0.0'
        }
      };
      
      await fs.writeJson(this.configFile, configWithMeta, { spaces: 2 });
      console.log('✅ Configuration saved successfully');
      
    } catch (error) {
      console.error('❌ Error saving configuration:', error);
      throw error;
    }
  }

  get(key, defaultValue = undefined) {
    if (this.config.hasOwnProperty(key)) {
      return this.config[key];
    }
    
    if (this.defaults.hasOwnProperty(key)) {
      return this.defaults[key];
    }
    
    return defaultValue;
  }

  set(key, value) {
    // Validate value based on schema
    const isValid = this.validateValue(key, value);
    
    if (!isValid) {
      throw new Error(`Invalid value for ${key}: ${value}`);
    }
    
    this.config[key] = value;
    console.log(`⚙️  Config updated: ${key} = ${JSON.stringify(value)}`);
  }

  getAll() {
    return { ...this.config };
  }

  setAll(newConfig) {
    // Validate all values
    for (const [key, value] of Object.entries(newConfig)) {
      if (key.startsWith('_')) continue; // Skip metadata
      this.validateValue(key, value);
    }
    
    // Update config
    this.config = { ...this.defaults, ...newConfig };
    this.validateConfig();
  }

  validateConfig() {
    // Validate search_mode
    const validSearchModes = ['api', 'ytdlp', 'hybrid'];
    if (!validSearchModes.includes(this.config.search_mode)) {
      console.warn(`⚠️  Invalid search_mode: ${this.config.search_mode}, using default`);
      this.config.search_mode = this.defaults.search_mode;
    }

    // Validate quality_preference
    const validQualities = ['best', 'worst', '720p', '1080p'];
    if (!validQualities.includes(this.config.quality_preference)) {
      console.warn(`⚠️  Invalid quality_preference: ${this.config.quality_preference}, using default`);
      this.config.quality_preference = this.defaults.quality_preference;
    }

    // Validate video_limit
    if (typeof this.config.video_limit !== 'number' || 
        this.config.video_limit < 5 || 
        this.config.video_limit > 50) {
      console.warn(`⚠️  Invalid video_limit: ${this.config.video_limit}, using default`);
      this.config.video_limit = this.defaults.video_limit;
    }

    // Validate followed_channels
    if (!Array.isArray(this.config.followed_channels)) {
      console.warn(`⚠️  Invalid followed_channels: not an array, using default`);
      this.config.followed_channels = this.defaults.followed_channels;
    } else {
      // Filter out invalid URLs
      this.config.followed_channels = this.config.followed_channels.filter(url => {
        if (typeof url !== 'string' || url.trim().length === 0) {
          return false;
        }
        
        // Basic YouTube URL validation
        const isValidYouTubeUrl = url.includes('youtube.com/') || url.includes('youtu.be/');
        if (!isValidYouTubeUrl) {
          console.warn(`⚠️  Invalid YouTube URL: ${url}`);
          return false;
        }
        
        return true;
      });
    }

    // Validate boolean fields
    if (typeof this.config.adult_content !== 'boolean') {
      this.config.adult_content = this.defaults.adult_content;
    }

    console.log('✅ Configuration validated');
  }

  validateValue(key, value) {
    switch (key) {
      case 'api_key':
        return typeof value === 'string';
        
      case 'search_mode':
        return ['api', 'ytdlp', 'hybrid'].includes(value);
        
      case 'quality_preference':
        return ['best', 'worst', '720p', '1080p'].includes(value);
        
      case 'video_limit':
        return typeof value === 'number' && value >= 5 && value <= 50;
        
      case 'followed_channels':
        return Array.isArray(value) && value.every(url => typeof url === 'string');
        
      case 'adult_content':
        return typeof value === 'boolean';
        
      default:
        console.warn(`⚠️  Unknown config key: ${key}`);
        return false;
    }
  }

  // Helper methods for specific config types
  addFollowedChannel(channelUrl) {
    if (typeof channelUrl !== 'string' || channelUrl.trim().length === 0) {
      throw new Error('Invalid channel URL');
    }
    
    const cleanUrl = channelUrl.trim();
    
    // Check if already exists
    if (this.config.followed_channels.includes(cleanUrl)) {
      return false; // Already exists
    }
    
    this.config.followed_channels.push(cleanUrl);
    console.log(`📺 Added followed channel: ${cleanUrl}`);
    return true;
  }

  removeFollowedChannel(channelUrl) {
    const index = this.config.followed_channels.indexOf(channelUrl);
    if (index > -1) {
      this.config.followed_channels.splice(index, 1);
      console.log(`🗑️  Removed followed channel: ${channelUrl}`);
      return true;
    }
    return false;
  }

  hasApiKey() {
    return this.config.api_key && this.config.api_key.length > 0;
  }

  isSearchModeApi() {
    return this.config.search_mode === 'api';
  }

  isAdultContentEnabled() {
    return this.config.adult_content === true;
  }

  getFollowedChannelsCount() {
    return this.config.followed_channels.length;
  }

  // Debug helpers
  printConfig() {
    console.log('📋 Current Configuration:');
    console.log('  Search Mode:', this.config.search_mode);
    console.log('  API Key:', this.hasApiKey() ? 'Set' : 'Not set');
    console.log('  Video Limit:', this.config.video_limit);
    console.log('  Quality Preference:', this.config.quality_preference);
    console.log('  Adult Content:', this.config.adult_content);
    console.log('  Followed Channels:', this.config.followed_channels.length);
  }
}

module.exports = ConfigManager;