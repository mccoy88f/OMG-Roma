FROM node:20-bookworm-slim

# Install system dependencies
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    bash \
    git \
  && rm -rf /var/lib/apt/lists/*

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

# Create directories first
RUN mkdir -p /app/config /app/plugins

# Copy plugins registry from repository AFTER creating directory
COPY config/plugins.json /app/config/plugins.json

# Debug: List what was copied
RUN echo "📂 Contents of /app/config:" && ls -la /app/config/ || echo "❌ /app/config not found"

# Create health check script inline
RUN echo '#!/bin/bash\nresponse=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3100/health)\nif [ "$response" = "200" ]; then\n    echo "✅ OMG-Roma Gateway is healthy"\n    exit 0\nelse\n    echo "❌ OMG-Roma Gateway health check failed (HTTP: $response)"\n    exit 1\nfi' > /app/health-check.sh && chmod +x /app/health-check.sh

# Create non-root user
RUN groupadd --gid 1001 nodejs && \
    useradd --uid 1001 --gid nodejs --shell /bin/bash --create-home nodejs

# Change ownership
RUN chown -R nodejs:nodejs /app

# Switch to non-root user
USER nodejs

# Expose port
EXPOSE 3100

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD /app/health-check.sh

# Start the application
CMD ["node", "src/index.js"]
