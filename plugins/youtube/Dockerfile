FROM node:20-bookworm-slim

# Install system dependencies and yt-dlp (seguendo approccio originale OMG-YouTube)
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    ffmpeg \
    python3 \
    python3-pip \
    curl \
    bash \
  && rm -rf /var/lib/apt/lists/* \
  && pip3 install --no-cache-dir yt-dlp --break-system-packages

# Create app directory
WORKDIR /app

# Copy package files
COPY plugins/youtube/package*.json ./

# Install npm dependencies
RUN npm ci --only=production

# Copy application code
COPY plugins/youtube/src/ ./src/
COPY plugins/youtube/plugin.json ./

# Create config directory
RUN mkdir -p /app/config

# Create health check script inline
RUN echo '#!/bin/bash\nresponse=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3001/health)\nif [ "$response" = "200" ]; then\n    echo "✅ OMG-Roma YouTube Plugin is healthy"\n    exit 0\nelse\n    echo "❌ OMG-Roma YouTube Plugin health check failed (HTTP: $response)"\n    exit 1\nfi' > /app/health-check.sh && chmod +x /app/health-check.sh

# Create non-root user
RUN groupadd --gid 1001 nodejs && \
    useradd --uid 1001 --gid nodejs --shell /bin/bash --create-home nodejs

# Change ownership
RUN chown -R nodejs:nodejs /app

# Switch to non-root user
USER nodejs

# Expose port
EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD /app/health-check.sh

# Start the application
CMD ["node", "src/index.js"]
