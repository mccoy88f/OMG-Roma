FROM node:20-bookworm-slim

# Install minimal system dependencies (yt-dlp is centralized in gateway)
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    bash \
    git \
  && apt-get clean \
  && rm -rf /var/lib/apt/lists/*

# Create app directory
WORKDIR /app

# Copy package files (with fallback if package-lock.json missing)
COPY plugins/youtube/package*.json ./

# Debug: List copied files
RUN ls -la /app/

# Install npm dependencies with fallback
RUN if [ -f package-lock.json ]; then \
      echo "🔒 Using npm ci (package-lock.json found)"; \
      npm ci --only=production --no-audit --no-fund; \
    else \
      echo "📦 Using npm install (no package-lock.json)"; \
      npm install --only=production --no-audit --no-fund; \
    fi

# Copy application code and config
COPY plugins/youtube/src/ ./src/
COPY plugins/youtube/plugin.json ./

# Copy default config from repository
COPY config/youtube.config.json ./config.json

# Create config directory
RUN mkdir -p /app/config

# No health check needed - plugin runs independently
# Gateway will retry connection when plugin is ready

# Create non-root user
RUN groupadd --gid 1001 nodejs && \
    useradd --uid 1001 --gid nodejs --shell /bin/bash --create-home nodejs

# Change ownership
RUN chown -R nodejs:nodejs /app

# Switch to non-root user
USER nodejs

# Expose port
EXPOSE 3001

# No health check - plugin runs independently
# Gateway handles connection retry logic

# Start the application
CMD ["node", "src/index.js"]
