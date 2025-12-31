# WAN Monitor

A self-hosted network monitoring dashboard that tracks WAN connectivity, latency, packet loss, jitter, and internet speeds over time.

## Features

- 🌐 Real-time WAN connectivity monitoring
- 📊 Historical tracking of network metrics
- ⚡ Speed test integration
- 📈 Beautiful, responsive charts
- 🐳 Self-contained Docker deployment
- 🔒 Basic authentication

## Tech Stack

- **Frontend**: React 18 + TypeScript + Vite
- **Backend**: Fastify + Effect-TS
- **Database**: QuestDB (time-series)
- **UI Library**: Chakra UI
- **Charts**: Recharts
- **Testing**: Vitest + React Testing Library
- **Linting & Formatting**: Biome.js
- **Container**: Docker with Nginx

## Quick Start

```bash
# Install dependencies
pnpm install

# Start everything (database + frontend + backend)
pnpm start:dev
```

This will:
1. Start QuestDB in Docker
2. Start the frontend on http://localhost:5173
3. Start the backend on http://localhost:3001

## Development

### Prerequisites

- Node.js 24+ (LTS)
- pnpm 8+
- Docker (for QuestDB)
- nvm (recommended for Node version management)

### Setup

```bash
# Use the correct Node.js version (if using nvm)
nvm use

# Install dependencies
pnpm install

# Copy environment variables (optional)
cp .env.example .env
```

### Development Commands

```bash
# Start everything (recommended)
pnpm start:dev

# Or start components individually:
pnpm db:up          # Start QuestDB
pnpm dev            # Start frontend only (http://localhost:5173)
pnpm dev:server     # Start backend only (http://localhost:3001)
pnpm dev:all        # Start frontend + backend (no database)

# Database management
pnpm db:up          # Start QuestDB container
pnpm db:down        # Stop QuestDB container
pnpm db:logs        # View QuestDB logs

# Run tests
pnpm test

# Run tests with UI
pnpm test:ui

# Run tests with coverage
pnpm test:coverage

# Lint code
pnpm lint

# Lint and auto-fix issues
pnpm lint:fix

# Format code
pnpm format

# Check and auto-fix both linting and formatting
pnpm check

# Build for production
pnpm build

# Preview production build
pnpm preview
```

## Docker Deployment

The Docker image is an all-in-one container that includes:
- **Frontend** (nginx serving static files)
- **Backend** (Node.js Fastify API server)
- **QuestDB** (embedded time-series database)
- **Supervisord** (process manager)

### Build Image

```bash
docker build -t wan-monitor .
```

### Run Container

```bash
# Basic usage
docker run -d \
  --name wan-monitor \
  -p 80:80 \
  wan-monitor

# With data persistence (recommended)
docker run -d \
  --name wan-monitor \
  -p 80:80 \
  -v wan-monitor-data:/var/lib/questdb \
  wan-monitor
```

### Verify Deployment

```bash
# Check health endpoint
curl http://localhost/api/health

# View logs
docker logs -f wan-monitor
```

### Stop and Remove

```bash
docker stop wan-monitor
docker rm wan-monitor

# Remove data volume (warning: deletes all data)
docker volume rm wan-monitor-data
```

### Ports

| Port | Service | Description |
|------|---------|-------------|
| 80 | nginx | Frontend + API proxy |

### Volumes

| Path | Description |
|------|-------------|
| `/var/lib/questdb` | QuestDB data directory |

## Configuration

All configuration is done via environment variables. Copy `.env.example` to `.env` and customize as needed.

### Server Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `SERVER_PORT` | `3001` | Port the backend API server listens on |
| `SERVER_HOST` | `0.0.0.0` | Host address the server binds to |

### Database Configuration (QuestDB)

| Variable | Default | Description |
|----------|---------|-------------|
| `DB_HOST` | `localhost` | QuestDB hostname |
| `DB_PORT` | `9000` | QuestDB HTTP port |
| `DB_PROTOCOL` | `http` | Protocol for QuestDB connection (`http` or `tcp`) |
| `DB_AUTO_FLUSH_ROWS` | `100` | Number of rows before auto-flush |
| `DB_AUTO_FLUSH_INTERVAL` | `1000` | Auto-flush interval in milliseconds |
| `DB_REQUEST_TIMEOUT` | `10000` | Request timeout in milliseconds |
| `DB_RETRY_TIMEOUT` | `1000` | Retry timeout in milliseconds |

### Ping Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `PING_TIMEOUT` | `5` | Ping timeout in seconds |
| `PING_TRAIN_COUNT` | `10` | Number of ICMP packets per ping train (for packet loss measurement) |
| `PING_HOSTS` | `8.8.8.8,1.1.1.1,cloudflare.com` | Comma-separated list of hosts to ping |

### Authentication Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `WAN_MONITOR_USERNAME` | `admin` | Username for dashboard login |
| `WAN_MONITOR_PASSWORD` | *(empty)* | Password for dashboard login (**required** - set a strong password) |
| `JWT_SECRET` | *(default)* | Secret key for JWT signing (**required** - set a random secret in production) |
| `JWT_EXPIRES_IN` | `24h` | JWT token expiration time (e.g., `24h`, `7d`) |

## Project Structure

```
wan-monitor/
├── src/
│   ├── main.tsx           # Application entry point
│   ├── App.tsx            # Root component
│   ├── test/
│   │   └── setup.ts       # Test configuration
│   └── vite-env.d.ts      # Vite type definitions
├── public/                # Static assets
├── Dockerfile             # Multi-stage Docker build
├── nginx.conf             # Nginx configuration
├── vite.config.ts         # Vite + Vitest configuration
├── tsconfig.json          # TypeScript configuration
└── package.json           # Project dependencies
```

## Monitoring Metrics

The dashboard tracks the following metrics:

- **Connectivity Status**: Real-time WAN availability (up/down/degraded)
- **Latency**: Ping times to reference hosts (8.8.8.8, 1.1.1.1)
- **Packet Loss**: Percentage of packets lost over time
- **Jitter**: Network stability and variance
- **Speed Tests**: Download/upload speeds (tested hourly)
- **Geographic Location**: Test server location

Data granularity:
- High-frequency metrics (connectivity, latency, packet loss, jitter): ≤60 seconds
- Speed tests: Every hour

## License

MIT
