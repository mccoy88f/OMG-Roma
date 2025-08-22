#!/bin/bash

# Health check script for OMG-Roma YouTube Plugin

# Check if the service is responding
response=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3001/health)

if [ "$response" = "200" ]; then
    echo "✅ OMG-Roma YouTube Plugin is healthy"
    exit 0
else
    echo "❌ OMG-Roma YouTube Plugin health check failed (HTTP: $response)"
    exit 1
fi