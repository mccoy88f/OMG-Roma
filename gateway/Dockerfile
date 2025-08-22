FROM node:18-alpine

# Install system dependencies
RUN apk add --no-cache \
    curl \
    bash

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

# Add health check script
COPY gateway/health-check.sh ./
RUN chmod +x health-check.sh

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
    CMD ./health-check.sh

# Start the application
CMD ["node", "src/index.js"]
