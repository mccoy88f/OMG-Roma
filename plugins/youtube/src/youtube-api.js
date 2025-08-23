const { google } = require('googleapis');

class YouTubeAPI {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.youtube = null;
    
    if (this.apiKey && this.apiKey.length > 0) {
      this.youtube = google.youtube({
        version: 'v3',
        auth: this.apiKey
      });
    }
  }

  isConfigured() {
    return this.youtube !== null;
  }

  async search(query, options = {}) {
    if (!this.isConfigured()) {
      throw new Error('YouTube API not configured');
    }

    const { skip = 0, limit = 20 } = options;

    try {
      console.log(`🔍 YouTube API search: "${query}"`);

      const response = await this.youtube.search.list({
        part: 'snippet',
        q: query,
        type: 'video',
        maxResults: Math.min(limit, 50), // API limit
        order: 'relevance',
        videoDefinition: 'any',
        videoEmbeddable: 'true',
        videoSyndicated: 'true'
      });

      if (!response.data.items) {
        return { videos: [], hasMore: false };
      }

      // Get additional video details
      const videoIds = response.data.items.map(item => item.id.videoId);
      const detailsResponse = await this.youtube.videos.list({
        part: 'contentDetails,statistics,status',
        id: videoIds.join(',')
      });

      const detailsMap = {};
      if (detailsResponse.data.items) {
        detailsResponse.data.items.forEach(item => {
          detailsMap[item.id] = item;
        });
      }

      // Convert to standardized format
      const videos = response.data.items.map(item => {
        const details = detailsMap[item.id.videoId];
        return this.convertToStandardFormat(item, details);
      }).filter(video => video !== null);

      // Apply skip offset (API doesn't support skip directly)
      const paginatedVideos = videos.slice(skip);
      const hasMore = response.data.nextPageToken && videos.length >= limit;

      console.log(`✅ YouTube API search completed: ${paginatedVideos.length} videos`);

      return {
        videos: paginatedVideos,
        hasMore
      };

    } catch (error) {
      console.error('❌ YouTube API search failed:', error);
      throw new Error(`YouTube API search failed: ${error.message}`);
    }
  }

  async getChannelVideos(channelId, options = {}) {
    if (!this.isConfigured()) {
      throw new Error('YouTube API not configured');
    }

    const { limit = 20, skip = 0 } = options;

    try {
      console.log(`📺 Getting channel videos: ${channelId}`);

      // First get channel uploads playlist
      const channelResponse = await this.youtube.channels.list({
        part: 'contentDetails',
        id: channelId
      });

      if (!channelResponse.data.items || channelResponse.data.items.length === 0) {
        throw new Error('Channel not found');
      }

      const uploadsPlaylistId = channelResponse.data.items[0].contentDetails.relatedPlaylists.uploads;

      // Get videos from uploads playlist with pagination
      const maxResults = Math.min(limit + skip, 50);
      const playlistResponse = await this.youtube.playlistItems.list({
        part: 'snippet',
        playlistId: uploadsPlaylistId,
        maxResults: maxResults
      });

      if (!playlistResponse.data.items) {
        return [];
      }

      // Get additional video details
      const videoIds = playlistResponse.data.items.map(item => item.snippet.resourceId.videoId);
      const detailsResponse = await this.youtube.videos.list({
        part: 'contentDetails,statistics,status',
        id: videoIds.join(',')
      });

      const detailsMap = {};
      if (detailsResponse.data.items) {
        detailsResponse.data.items.forEach(item => {
          detailsMap[item.id] = item;
        });
      }

      // Convert to standardized format
      const videos = playlistResponse.data.items.map(item => {
        const videoItem = {
          id: { videoId: item.snippet.resourceId.videoId },
          snippet: item.snippet
        };
        const details = detailsMap[item.snippet.resourceId.videoId];
        return this.convertToStandardFormat(videoItem, details);
      }).filter(video => video !== null);

      // Apply skip and limit
      const paginatedVideos = videos.slice(skip, skip + limit);
      const hasMore = videos.length > skip + limit;

      console.log(`✅ Channel videos retrieved: ${paginatedVideos.length} videos (${skip}-${skip + limit})`);

      return {
        videos: paginatedVideos,
        hasMore
      };

    } catch (error) {
      console.error('❌ YouTube API channel videos failed:', error);
      throw new Error(`YouTube API channel videos failed: ${error.message}`);
    }
  }

  async resolveChannelId(channelUrl) {
    if (!this.isConfigured()) {
      throw new Error('YouTube API not configured');
    }

    try {
      let channelId = channelUrl;

      if (channelUrl.includes('@')) {
        // Handle @username format
        const username = channelUrl.split('@')[1].split('/')[0];
        console.log(`🔍 Resolving username: ${username}`);
        
        // Search for channel by username
        const searchResponse = await this.youtube.search.list({
          part: 'snippet',
          q: username,
          type: 'channel',
          maxResults: 1
        });

        if (searchResponse.data.items && searchResponse.data.items.length > 0) {
          channelId = searchResponse.data.items[0].snippet.channelId;
          console.log(`✅ Resolved @${username} to channel ID: ${channelId}`);
        } else {
          throw new Error(`Channel not found for username: ${username}`);
        }
      } else if (channelUrl.includes('channel/')) {
        // Handle /channel/ID format
        channelId = channelUrl.split('channel/')[1].split('/')[0];
        console.log(`✅ Using channel ID directly: ${channelId}`);
      } else if (channelUrl.includes('c/')) {
        // Handle /c/username format
        const username = channelUrl.split('c/')[1].split('/')[0];
        console.log(`🔍 Resolving custom URL: ${username}`);
        
        // Search for channel by custom URL
        const searchResponse = await this.youtube.search.list({
          part: 'snippet',
          q: username,
          type: 'channel',
          maxResults: 1
        });

        if (searchResponse.data.items && searchResponse.data.items.length > 0) {
          channelId = searchResponse.data.items[0].snippet.channelId;
          console.log(`✅ Resolved /c/${username} to channel ID: ${channelId}`);
        } else {
          throw new Error(`Channel not found for custom URL: ${username}`);
        }
      }

      return channelId;
    } catch (error) {
      console.error('❌ Failed to resolve channel ID:', error);
      throw new Error(`Channel ID resolution failed: ${error.message}`);
    }
  }

  async getChannelInfo(channelId) {
    if (!this.isConfigured()) {
      throw new Error('YouTube API not configured');
    }

    try {
      console.log(`📺 Getting channel info: ${channelId}`);

      const response = await this.youtube.channels.list({
        part: 'snippet,statistics,contentDetails',
        id: channelId
      });

      if (!response.data.items || response.data.items.length === 0) {
        throw new Error('Channel not found');
      }

      const channel = response.data.items[0];
      return {
        id: channel.id,
        title: channel.snippet.title,
        description: channel.snippet.description,
        thumbnail: this.getBestThumbnail(channel.snippet.thumbnails),
        subscriberCount: channel.statistics?.subscriberCount ? parseInt(channel.statistics.subscriberCount) : 0,
        videoCount: channel.statistics?.videoCount ? parseInt(channel.statistics.videoCount) : 0,
        viewCount: channel.statistics?.viewCount ? parseInt(channel.statistics.viewCount) : 0,
        uploadsPlaylistId: channel.contentDetails?.relatedPlaylists?.uploads
      };

    } catch (error) {
      console.error('❌ YouTube API channel info failed:', error);
      throw new Error(`YouTube API channel info failed: ${error.message}`);
    }
  }

  convertToStandardFormat(item, details) {
    try {
      // Skip if no video ID
      if (!item.id?.videoId) {
        return null;
      }

      // Skip private or deleted videos
      if (details?.status?.privacyStatus === 'private') {
        return null;
      }

      const video = {
        id: item.id.videoId,
        title: item.snippet.title,
        description: item.snippet.description || '',
        thumbnail: this.getBestThumbnail(item.snippet.thumbnails),
        url: `https://www.youtube.com/watch?v=${item.id.videoId}`,
        channel: item.snippet.channelTitle,
        channelId: item.snippet.channelId,
        publishedAt: item.snippet.publishedAt,
        viewCount: details?.statistics?.viewCount ? parseInt(details.statistics.viewCount) : 0,
        likeCount: details?.statistics?.likeCount ? parseInt(details.statistics.likeCount) : 0,
        duration: details?.contentDetails?.duration ? this.parseISO8601Duration(details.contentDetails.duration) : '',
        tags: item.snippet.tags || [],
        adult: this.detectAdultContent(item)
      };

      // Calculate rating
      video.rating = this.calculateRating(video);

      return video;

    } catch (error) {
      console.warn('⚠️  Failed to convert video format:', error);
      return null;
    }
  }

  getBestThumbnail(thumbnails) {
    if (!thumbnails) return '';
    
    // Priority: maxres > high > medium > default
    const priorities = ['maxres', 'high', 'medium', 'default'];
    
    for (const priority of priorities) {
      if (thumbnails[priority]) {
        return thumbnails[priority].url;
      }
    }
    
    return '';
  }

  parseISO8601Duration(duration) {
    // Convert ISO 8601 duration (PT4M13S) to MM:SS format
    const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
    
    if (!match) return '';
    
    const hours = parseInt(match[1]) || 0;
    const minutes = parseInt(match[2]) || 0;
    const seconds = parseInt(match[3]) || 0;
    
    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    }
    
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  }

  calculateRating(video) {
    // Calculate a rating based on views, likes, and other metrics
    const viewCount = video.viewCount || 0;
    const likeCount = video.likeCount || 0;
    
    if (viewCount === 0) return 0;
    
    const likeRatio = likeCount / viewCount;
    const viewScore = Math.min(10, Math.log10(viewCount + 1));
    const likeScore = Math.min(10, likeRatio * 1000);
    
    return Math.round((viewScore + likeScore) / 2 * 10) / 10;
  }

  detectAdultContent(item) {
    // Simple adult content detection based on title and description
    const adultKeywords = ['adult', 'nsfw', 'explicit', '18+', 'mature'];
    const title = (item.snippet.title || '').toLowerCase();
    const description = (item.snippet.description || '').toLowerCase();
    
    const content = `${title} ${description}`;
    
    return adultKeywords.some(keyword => content.includes(keyword));
  }

  async getQuotaUsage() {
    // This would require additional API calls to get quota usage
    // For now, return estimated usage
    return {
      estimated: true,
      message: 'Check Google Cloud Console for actual quota usage'
    };
  }
}

module.exports = YouTubeAPI;