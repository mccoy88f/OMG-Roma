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

# DEBUG: Show repository structure
RUN echo "=== REPOSITORY STRUCTURE ===" && \
    find . -name "*.json" | head -20

# Copy package files
COPY gateway/package*.json ./

# Install npm dependencies
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

# Create directories
RUN mkdir -p /app/config /app/plugins

# DEBUG: Check if plugins.json exists in repo
RUN echo "=== CHECKING PLUGINS.JSON ===" && \
    ls -la config/ || echo "❌ config/ directory not found" && \
    cat config/plugins.json || echo "❌ config/plugins.json not found"

# Copy plugins registry from repository
COPY config/plugins.json /app/config/plugins.json

# DEBUG: Verify copy worked
RUN echo "=== VERIFY COPY ===" && \
    ls -la /app/config/ && \
    cat /app/config/plugins.json

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
