FROM node:18-alpine

# Install system dependencies
RUN apk add --no-cache \
    curl \
    bash \
    && apk add --virtual .tmp-build-deps \
    build-base \
    && apk del .tmp-build-deps

# Create app directory
WORKDIR /app

# Copy package files
COPY gateway/package*.json ./

# Install dependencies with better error handling
RUN npm ci --only=production --no-audit --no-fund

# Copy application code
COPY gateway/src/ ./src/
COPY gateway/public/ ./public/

# Create directories
RUN mkdir -p /app/config /app/plugins

# Create health check script inline
RUN echo '#!/bin/bash\nresponse=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3100/health)\nif [ "$response" = "200" ]; then\n    echo "✅ OMG-Roma Gateway is healthy"\n    exit 0\nelse\n    echo "❌ OMG-Roma Gateway health check failed (HTTP: $response)"\n    exit 1\nfi' > /app/health-check.sh && chmod +x /app/health-check.sh

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

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
