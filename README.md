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

## Docker

### Build Image

```bash
docker build -t wan-monitor .
```

### Run Container

```bash
docker run -d \
  --name wan-monitor \
  -p 3000:80 \
  -e WAN_MONITOR_USER=admin \
  -e WAN_MONITOR_PASSWORD=changeme \
  wan-monitor
```

### Environment Variables

- `WAN_MONITOR_USER` - Dashboard username (default: admin)
- `WAN_MONITOR_PASSWORD` - Dashboard password (default: changeme)
- `PORT` - Server port inside container (default: 80)

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
