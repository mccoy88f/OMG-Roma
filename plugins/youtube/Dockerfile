FROM node:18-alpine

# Install system dependencies and build tools
RUN apk add --no-cache \
    python3 \
    py3-pip \
    py3-setuptools \
    py3-wheel \
    ffmpeg \
    curl \
    bash \
    gcc \
    musl-dev \
    python3-dev \
    libffi-dev \
    openssl-dev \
    cargo \
    rust

# Install yt-dlp with build dependencies
RUN pip3 install --no-cache-dir --upgrade pip setuptools wheel && \
    pip3 install --no-cache-dir yt-dlp

# Clean up build dependencies to reduce image size
RUN apk del gcc musl-dev python3-dev libffi-dev openssl-dev cargo rust

# Create app directory
WORKDIR /app

# Copy package files
COPY plugins/youtube/package*.json ./

# Install npm dependencies
RUN npm ci --only=production

# Copy application code
COPY plugins/youtube/src/ ./src/

# Copy plugin configuration
COPY plugins/youtube/plugin.json ./

# Create config directory
RUN mkdir -p /app/config

# Create health check script inline
RUN echo '#!/bin/bash\nresponse=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3001/health)\nif [ "$response" = "200" ]; then\n    echo "✅ OMG-Roma YouTube Plugin is healthy"\n    exit 0\nelse\n    echo "❌ OMG-Roma YouTube Plugin health check failed (HTTP: $response)"\n    exit 1\nfi' > /app/health-check.sh && chmod +x /app/health-check.sh

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

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
