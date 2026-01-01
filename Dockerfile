# =============================================================================
# WAN Monitor - All-in-One Production Docker Image
# =============================================================================
# This image contains:
# - Frontend (nginx serving static files)
# - Backend (Node.js Fastify server)
# - QuestDB (embedded time-series database)
# - Supervisord (process manager)
# =============================================================================

# -----------------------------------------------------------------------------
# Stage 1: Build Frontend
# -----------------------------------------------------------------------------
# Using bookworm (Debian) instead of Alpine to ensure native modules are
# compiled with glibc, matching the Ubuntu production image
FROM node:22-bookworm AS frontend-builder

# Install build dependencies for native modules (lzma-native requires liblzma-dev)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ liblzma-dev \
    && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* ./
COPY apps/web/package.json apps/web/package.json
COPY apps/server/package.json apps/server/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY scripts scripts
COPY patches patches
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm exec turbo run build --filter=@wan-monitor/web

# -----------------------------------------------------------------------------
# Stage 2: Build Backend
# -----------------------------------------------------------------------------
# Using bookworm (Debian) instead of Alpine to ensure native modules are
# compiled with glibc, matching the Ubuntu production image
FROM node:22-bookworm AS backend-builder

# Install build dependencies for native modules (lzma-native requires liblzma-dev)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ liblzma-dev \
    && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* ./
COPY apps/web/package.json apps/web/package.json
COPY apps/server/package.json apps/server/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY scripts scripts
COPY patches patches
RUN pnpm install --frozen-lockfile --prod=false

COPY . .
RUN pnpm exec turbo run build --filter=@wan-monitor/server

# Deploy server with production dependencies using pnpm deploy
RUN pnpm --filter=@wan-monitor/server deploy --prod /tmp/server-deploy

# -----------------------------------------------------------------------------
# Stage 3: Production Runtime (All-in-One)
# -----------------------------------------------------------------------------
FROM ubuntu:24.04 AS production

# Avoid prompts during package installation
ENV DEBIAN_FRONTEND=noninteractive

# Install dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    nginx \
    supervisor \
    curl \
    wget \
    ca-certificates \
    openjdk-17-jre-headless \
    iputils-ping \
    && rm -rf /var/lib/apt/lists/*

# Install Node.js 22
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# Download and install QuestDB
ARG QUESTDB_VERSION=9.2.3
RUN mkdir -p /opt/questdb /var/lib/questdb \
    && wget -q "https://github.com/questdb/questdb/releases/download/${QUESTDB_VERSION}/questdb-${QUESTDB_VERSION}-no-jre-bin.tar.gz" -O /tmp/questdb.tar.gz \
    && tar -xzf /tmp/questdb.tar.gz -C /opt/questdb --strip-components=1 \
    && rm /tmp/questdb.tar.gz \
    && chmod +x /opt/questdb/bin/*.sh 2>/dev/null || true

# Create log directories
RUN mkdir -p /var/log/supervisor /var/log/nginx

# Copy frontend build
COPY --from=frontend-builder /app/dist /usr/share/nginx/html

# Copy backend build and production dependencies from pnpm deploy
COPY --from=backend-builder /app/dist/server /app/backend
COPY --from=backend-builder /tmp/server-deploy/node_modules /app/node_modules

# Copy configuration files
COPY docker/nginx.prod.conf /etc/nginx/sites-available/default
COPY docker/supervisord.conf /etc/supervisor/conf.d/supervisord.conf
COPY docker/questdb-log.conf /var/lib/questdb/conf/log.conf

# Remove default nginx config
RUN rm -f /etc/nginx/sites-enabled/default \
    && ln -s /etc/nginx/sites-available/default /etc/nginx/sites-enabled/default

# Expose port 80 (nginx serves frontend + proxies /api to backend)
# All other services (backend:3001, QuestDB:9000/9009) are internal only
EXPOSE 80

# Volume for QuestDB data persistence
VOLUME ["/var/lib/questdb"]

# =============================================================================
# Environment Variables
# =============================================================================
# These can be overridden at runtime via:
#   docker run -e VAR=value
#   docker-compose.yml environment section
#   .env file with docker-compose
# =============================================================================

# Server configuration (with defaults)
ENV NODE_ENV=production
ENV SERVER_PORT=3001
ENV SERVER_HOST=0.0.0.0

# Logging configuration (with defaults)
ENV LOG_LEVEL=warn
ENV LOG_PRETTY=false

# Database configuration (with defaults for embedded QuestDB)
ENV DB_HOST=localhost
ENV DB_PORT=9000
ENV DB_PROTOCOL=http

# Ping configuration (with defaults)
ENV PING_TIMEOUT=5
ENV PING_TRAIN_COUNT=10
ENV PING_HOSTS=8.8.8.8,1.1.1.1,cloudflare.com

# Authentication configuration (no defaults - set at runtime for security)
# ENV WAN_MONITOR_USERNAME=admin  # Default is 'admin' if not set
# ENV WAN_MONITOR_PASSWORD=       # Required to enable auth
# ENV JWT_SECRET=                 # Required for secure token signing
# ENV JWT_EXPIRES_IN=24h          # Default is '24h' if not set

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD curl -f http://localhost/api/live || exit 1

# Start supervisord
CMD ["/usr/bin/supervisord", "-c", "/etc/supervisor/conf.d/supervisord.conf"]
