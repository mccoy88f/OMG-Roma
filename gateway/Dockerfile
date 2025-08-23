FROM node:20-bullseye-slim

# Install system dependencies with better error handling and retry
RUN apt-get update --fix-missing \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    bash \
    git \
    python3 \
    python3-pip \
    ffmpeg \
  && pip3 install --upgrade --no-cache-dir --timeout 300 yt-dlp \
  && apt-get clean \
  && rm -rf /var/lib/apt/lists/* \
  && rm -rf /tmp/* \
  && rm -rf /var/tmp/*

# Verify installations
RUN python3 --version \
  && pip3 --version \
  && yt-dlp --version \
  && ffmpeg -version

# Create app directory
WORKDIR /app

# Copy package files (with fallback if package-lock.json missing)
COPY gateway/package*.json ./

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

# Copy application code
COPY gateway/src/ ./src/
COPY gateway/public/ ./public/

# Create config directory FIRST
RUN mkdir -p /app/config /app/plugins /app/cache/ytdlp /app/cache/proxy

# Try multiple approaches to copy the file
# Approach 1: Direct copy
COPY config/plugins.json /app/config/plugins.json

# Verify the copy worked
RUN echo "📂 Verifying plugins.json copy:" && \
    echo "📁 Config directory contents:" && \
    ls -la /app/config/ && \
    echo "📄 File size and content:" && \
    wc -c /app/config/plugins.json && \
    cat /app/config/plugins.json && \
    echo "📊 Validation complete"

# No health check needed - gateway is always running
# Simple process monitoring is sufficient

# Create non-root user
RUN groupadd --gid 1001 nodejs && \
    useradd --uid 1001 --gid nodejs --shell /bin/bash --create-home nodejs

# Change ownership
RUN chown -R nodejs:nodejs /app

# Switch to non-root user
USER nodejs

# Expose port
EXPOSE 3100

# No health check - gateway runs continuously
# Plugin connection retry is handled in application logic

# Start the application
CMD ["node", "src/index.js"]
