FROM node:18-slim

# Install system dependencies
RUN apt-get update && apt-get install -y \
    curl \
    bash \
    && rm -rf /var/lib/apt/lists/*

# Create app directory
WORKDIR /app

# Copy package files
COPY gateway/package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy application code
COPY gateway/src/ ./src/
COPY gateway/public/ ./public/

# Create directories
RUN mkdir -p /app/config /app/plugins

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
