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
FROM node:24-alpine AS frontend-builder

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

COPY package.json pnpm-lock.yaml* ./
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm run build

# -----------------------------------------------------------------------------
# Stage 2: Build Backend
# -----------------------------------------------------------------------------
FROM node:24-alpine AS backend-builder

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

COPY package.json pnpm-lock.yaml* ./
RUN pnpm install --frozen-lockfile --prod=false

COPY . .
RUN pnpm run build:server

# Install production dependencies only (skip prepare script)
RUN pnpm install --frozen-lockfile --prod --ignore-scripts

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
    && rm -rf /var/lib/apt/lists/*

# Install Node.js 24
RUN curl -fsSL https://deb.nodesource.com/setup_24.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# Download and install QuestDB
ARG QUESTDB_VERSION=8.2.3
RUN mkdir -p /opt/questdb /var/lib/questdb \
    && wget -q "https://github.com/questdb/questdb/releases/download/${QUESTDB_VERSION}/questdb-${QUESTDB_VERSION}-no-jre-bin.tar.gz" -O /tmp/questdb.tar.gz \
    && tar -xzf /tmp/questdb.tar.gz -C /opt/questdb --strip-components=1 \
    && rm /tmp/questdb.tar.gz \
    && chmod +x /opt/questdb/bin/*.sh 2>/dev/null || true

# Create log directories
RUN mkdir -p /var/log/supervisor /var/log/nginx

# Copy frontend build
COPY --from=frontend-builder /app/dist /usr/share/nginx/html

# Copy backend build and production dependencies
COPY --from=backend-builder /app/dist/server /app/backend
COPY --from=backend-builder /app/node_modules /app/node_modules
COPY --from=backend-builder /app/package.json /app/package.json

# Copy configuration files
COPY docker/nginx.prod.conf /etc/nginx/sites-available/default
COPY docker/supervisord.conf /etc/supervisor/conf.d/supervisord.conf

# Remove default nginx config
RUN rm -f /etc/nginx/sites-enabled/default \
    && ln -s /etc/nginx/sites-available/default /etc/nginx/sites-enabled/default

# Expose port 80 (nginx serves frontend + proxies /api to backend)
# All other services (backend:3001, QuestDB:9000/9009) are internal only
EXPOSE 80

# Volume for QuestDB data persistence
VOLUME ["/var/lib/questdb"]

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD curl -f http://localhost/api/health || exit 1

# Start supervisord
CMD ["/usr/bin/supervisord", "-c", "/etc/supervisor/conf.d/supervisord.conf"]
