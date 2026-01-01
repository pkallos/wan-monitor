# WAN Monitor

A self-hosted network monitoring dashboard that tracks your internet connection quality over time. It continuously monitors latency, packet loss, jitter, and runs periodic speed tests—storing everything in a time-series database so you can visualize trends and diagnose connectivity issues.

![License](https://img.shields.io/badge/license-GPL--3.0-blue)

<!-- TODO: Add screenshot of the dashboard -->
![Dashboard Screenshot](docs/screenshot.png)

## What It Does

WAN Monitor runs on your local network and performs two types of tests:

**Ping Monitoring** (every 60 seconds by default)
- Sends ICMP pings to configurable hosts (default: 8.8.8.8, 1.1.1.1, cloudflare.com)
- Measures latency, packet loss, and jitter
- Determines connectivity status (up/down/degraded)

**Speed Tests** (every hour by default)
- Runs Ookla-based speed tests via speedtest-net
- Measures download and upload speeds
- Captures ISP name, server location, and your external IP

All data is stored in QuestDB (a time-series database) and displayed in a responsive web dashboard with interactive charts.

## Quick Start with Docker

The easiest way to run WAN Monitor is with Docker. The image is self-contained with the frontend, backend, and database all bundled together.

```bash
docker run -d \
  --name wan-monitor \
  -p 8080:80 \
  -v wan-monitor-data:/var/lib/questdb \
  phibit/wan-monitor:latest
```

Then open http://localhost:8080 in your browser.

### With Authentication

To protect the dashboard with a login:

```bash
docker run -d \
  --name wan-monitor \
  -p 8080:80 \
  -e WAN_MONITOR_PASSWORD=your-secure-password \
  -e JWT_SECRET=$(openssl rand -base64 32) \
  -v wan-monitor-data:/var/lib/questdb \
  phibit/wan-monitor:latest
```

### Using Docker Compose

Create a `docker-compose.yml`:

```yaml
services:
  wan-monitor:
    image: phibit/wan-monitor:latest
    container_name: wan-monitor
    ports:
      - "8080:80"
    environment:
      - WAN_MONITOR_PASSWORD=your-secure-password
      - JWT_SECRET=your-random-secret-key-here
      - PING_HOSTS=8.8.8.8,1.1.1.1,cloudflare.com
    volumes:
      - wan-monitor-data:/var/lib/questdb
    restart: unless-stopped

volumes:
  wan-monitor-data:
```

Then run:

```bash
docker-compose up -d
```

## Configuration

All configuration is done via environment variables.

### Monitoring Settings

| Variable | Default | Description |
|----------|---------|-------------|
| `PING_HOSTS` | `8.8.8.8,1.1.1.1,cloudflare.com` | Comma-separated hosts to ping |
| `PING_INTERVAL_SECONDS` | `60` | How often to run ping tests |
| `PING_TIMEOUT` | `5` | Ping timeout in seconds |
| `PING_TRAIN_COUNT` | `10` | Number of packets per ping (for packet loss calculation) |
| `SPEEDTEST_INTERVAL_SECONDS` | `3600` | How often to run speed tests (default: 1 hour) |

### Authentication

| Variable | Default | Description |
|----------|---------|-------------|
| `WAN_MONITOR_USERNAME` | `admin` | Login username |
| `WAN_MONITOR_PASSWORD` | *(empty)* | Login password. **If empty, authentication is disabled.** |
| `JWT_SECRET` | *(empty)* | Secret for signing tokens. **Required if password is set.** |
| `JWT_EXPIRES_IN` | `24h` | How long login sessions last |

### Server & Database

| Variable | Default | Description |
|----------|---------|-------------|
| `SERVER_PORT` | `3001` | Backend API port (internal) |
| `LOG_LEVEL` | `info` | Logging verbosity: trace, debug, info, warn, error |
| `DB_HOST` | `localhost` | QuestDB host |
| `DB_PORT` | `9000` | QuestDB HTTP port |

## Architecture

```
+------------------------------------------------------------------+
|                        Docker Container                          |
|                                                                  |
|  +----------+      +----------+      +--------------------+      |
|  |  Nginx   |----->|  Fastify |----->|      QuestDB       |      |
|  | (port 80)|      | (port    |      |  (time-series DB)  |      |
|  |          |      |  3001)   |      |                    |      |
|  +----+-----+      +----+-----+      +---------^----------+      |
|       |                 |                      |                 |
|       v                 v                      |                 |
|  Static Files      Ping Service ---------------+                 |
|  (React SPA)       Speedtest Service ----------+                 |
|                                                                  |
+------------------------------------------------------------------+
```

**Tech Stack:**
- **Frontend**: React 18 + TypeScript + Vite + Chakra UI + Recharts
- **Backend**: Fastify + Effect-TS (functional error handling)
- **Database**: QuestDB (columnar time-series database)
- **Process Manager**: Supervisord (manages all services in the container)
- **Reverse Proxy**: Nginx (serves frontend, proxies API requests)

## Dashboard Features

- **Connectivity Status Chart**: Shows network availability over time (up/down/degraded) with uptime percentage
- **Latency Chart**: Ping times to each configured host
- **Packet Loss Chart**: Percentage of packets lost
- **Jitter Chart**: Network stability (variance in latency)
- **Speed Test History**: Download and upload speeds over time
- **ISP & IP Display**: Shows your current ISP and external IP address

**Time Range Options**: 1 hour, 6 hours, 24 hours, 7 days, 30 days

Charts support linked cursors (hovering on one chart highlights the same time on others) and automatic data aggregation based on the selected time range.

## Limitations

This tool monitors your internet connection **from the device running the container**. Keep in mind:

- **Local network issues affect readings**: If your WiFi is flaky or there's congestion on your LAN, this will show up in the metrics even if your WAN connection is fine.
- **Speed tests use bandwidth**: Each hourly speed test consumes actual bandwidth. On metered connections, consider increasing `SPEEDTEST_INTERVAL_SECONDS`.
- **Single vantage point**: This monitors from one location. It won't detect issues that only affect specific routes or destinations.
- **Designed for home/small office use**: Not intended for enterprise network monitoring.

## Development Setup

### Prerequisites

- Node.js 22+ (see `.nvmrc`)
- pnpm 8+
- Docker (for running QuestDB locally)

### Getting Started

```bash
# Clone the repo
git clone https://github.com/pkallos/wan-monitor.git
cd wan-monitor

# Use correct Node version
nvm use

# Install dependencies
pnpm install

# Start everything (QuestDB + frontend + backend)
pnpm start:dev
```

This starts:
- Frontend at http://localhost:5173
- Backend API at http://localhost:3001
- QuestDB at http://localhost:9000 (web console)

### Development Commands

```bash
# Start all services
pnpm start:dev

# Start individually
pnpm db:up          # Start QuestDB only
pnpm dev            # Start frontend only
pnpm dev:server     # Start backend only

# Testing
pnpm test           # Run all tests
pnpm test:watch     # Watch mode
pnpm test:coverage  # With coverage report

# Code quality
pnpm lint           # Check for issues
pnpm format         # Auto-format code
pnpm check          # Lint + format

# Build
pnpm build          # Production build
pnpm typecheck      # TypeScript validation
```

### Project Structure

```
wan-monitor/
├── apps/
│   ├── web/                 # React frontend
│   │   ├── src/
│   │   │   ├── components/  # UI components (Dashboard, charts, etc.)
│   │   │   ├── api/         # API client and React Query hooks
│   │   │   ├── context/     # Auth context
│   │   │   └── hooks/       # Custom hooks
│   │   └── ...
│   └── server/              # Fastify backend
│       ├── src/
│       │   ├── server/      # HTTP routes and middleware
│       │   ├── services/    # Ping, speedtest, network monitor
│       │   └── database/    # QuestDB client
│       └── ...
├── packages/
│   └── shared/              # Shared types and schemas
├── docker/                  # Production Docker configs
├── Dockerfile               # Multi-stage production build
└── docker-compose.yml       # Development database
```

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/health` | GET | Health check |
| `/api/auth/status` | GET | Check if auth is required |
| `/api/auth/login` | POST | Login (returns JWT) |
| `/api/metrics` | GET | Query ping and speedtest data |
| `/api/connectivity-status` | GET | Aggregated up/down/degraded status |
| `/api/ping/trigger` | POST | Manually trigger a ping test |
| `/api/ping/hosts` | GET | Get configured ping hosts |

Query parameters for `/api/metrics`:
- `startTime`: ISO timestamp
- `endTime`: ISO timestamp
- `granularity`: `1m`, `5m`, `15m`, `1h`, `6h`, `1d`
- `host`: Filter by specific ping host

## Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch
3. Make your changes with tests
4. Run `pnpm check` to ensure code quality
5. Submit a pull request

This project uses [Biome](https://biomejs.dev/) for linting and formatting. Pre-commit hooks will automatically check your code.

## License

This project is licensed under the GNU General Public License v3.0 (GPL-3.0). See the [LICENSE](LICENSE) file for details.

This means you're free to use, modify, and distribute this software, but any derivative works must also be open source under GPL-3.0.

---

## Author's Notes

This project was almost entirely ✨Vibe Coded✨ using the following toolchain:
 - Windsurf IDE with:
    - MCP tools: GitHub, Linear, Exa
    - Models: mainly Sonnet-4.5, Opus-4.5, and GPT-5.2 with low/medium/high reasoning

I started the project by:
 1. Started by describing a sketch of the project in REQUIREMENTS.md
 2. Connected and authenticated the Linear and GitHub MCP tools

Then the workflow for iterating on the project was as follows:
 1. Use prompting to generate Linear tasks for feature generation and bug fixes
 2. Have Windsurf agent pull the Linear task and generate a feature branch, develop a solution + tests, and then open a PR in GitHub
 3. I'd review the PR and test the changes locally, iterate until it was good enough, then merge the GitHub PR which would close the Linear task
 4. Repeat

Overall from inception to publishing, this project took about 15 hours of time, which is considerably faster than the normal development process.

Generally when I start side projects it's partly to learn and test new tools and frameworks, so the stack choice was done with that in mind:
 - Vite (I normally use Next.js, but I wanted to try something different)
 - Chakra UI (I normally use Tailwind, but I wanted to try something different)
 - Fastify (I normally use Express, but I wanted to try something different)
 - Effect-TS (I wanted to try something different)
 - QuestDB (I wanted to try a different time-series database)
 - Experimenting with a new AI-assisted dev workflow

Generally, taking this approach for a new project really accelerates learning and progress, although the process is manual, long, time-consuming, and interrupted by hours of manual research and documentation reading. However, because I ended up generating much of the code, I was effectively robbed of the experience of learning the frameworks and tools, and I ended up learning them in a much more passive way. There were major productivity gains, but by necessity they came at the expense of me improving my understanding :). Not something I'm mad about, just a general observation. I expect as these tools mature they will produce more layers of abstraction that will continue to improve productivity at the expense of understanding, as has been the general trend as tools and software development practices evolve, and probably a net positive!
