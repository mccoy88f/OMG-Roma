#!/bin/bash

# Health check script for OMG-Roma Gateway

# Check if the service is responding
response=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3100/health)

if [ "$response" = "200" ]; then
    echo "✅ OMG-Roma Gateway is healthy"
    exit 0
else
    echo "❌ OMG-Roma Gateway health check failed (HTTP: $response)"
    exit 1
fi