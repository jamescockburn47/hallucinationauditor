# Multi-stage build for hallucination auditor
FROM python:3.11-slim as backend-builder

WORKDIR /app

# Install build dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    g++ \
    libxml2-dev \
    libxslt1-dev \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements and install Python dependencies
COPY requirements-prod.txt .
RUN pip install --no-cache-dir -r requirements-prod.txt

# Frontend build stage
FROM node:20-slim as frontend-builder

WORKDIR /app/ui

# Copy frontend files
COPY ui/package*.json ./
RUN npm ci --legacy-peer-deps

COPY ui/ ./
RUN npm run build

# Final production image
FROM python:3.11-slim

WORKDIR /app

# Install runtime dependencies only
RUN apt-get update && apt-get install -y --no-install-recommends \
    libxml2 \
    libxslt1.1 \
    && rm -rf /var/lib/apt/lists/*

# Copy Python packages from builder
COPY --from=backend-builder /usr/local/lib/python3.11/site-packages /usr/local/lib/python3.11/site-packages
COPY --from=backend-builder /usr/local/bin /usr/local/bin

# Copy application code
COPY api/ ./api/
COPY scripts/ ./scripts/

# Copy built frontend to static directory
COPY --from=frontend-builder /app/ui/dist ./static/

# Create cache directories
RUN mkdir -p cache reports

# Set environment variables
ENV PYTHONUNBUFFERED=1
ENV PYTHONPATH=/app:/app/scripts

# Expose port (Railway will set PORT env var)
EXPOSE 8000

# Use shell form to allow variable substitution
CMD uvicorn api.server:app --host 0.0.0.0 --port ${PORT:-8000}
