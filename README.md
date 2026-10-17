# WAN Monitor

A self-hosted network monitoring dashboard that tracks your internet connection quality over time. It continuously monitors latency, packet loss, jitter, and runs periodic speed tests—storing everything in a time-series database so you can visualize trends and diagnose connectivity issues.

![License](https://img.shields.io/badge/license-GPL--3.0-blue)


## What It Does

WAN Monitor runs on your local network and performs two types of tests:

**Ping Monitoring** (every 30 seconds by default)
- Sends ICMP pings to configurable hosts (default: 8.8.8.8, 1.1.1.1, cloudflare.com)
- Measures latency, packet loss, and jitter
- Determines connectivity status (up/down/degraded)

**Speed Tests** (every hour by default)
- Runs Ookla-based speed tests via speedtest-net
- Measures download and upload speeds
- Captures ISP name, server location, and your external IP

All data is stored in QuestDB (a time-series database) and displayed in a responsive web dashboard with interactive charts.

<img width="720" height="584" alt="image" src="https://github.com/user-attachments/assets/f8e52da7-31ee-4cbe-92e5-e694ed3deb29" />


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
| `PING_INTERVAL_SECONDS` | `30` | How often to run ping tests |
| `PING_TIMEOUT` | `5` | Ping timeout in seconds |
| `PING_TRAIN_COUNT` | `10` | Number of packets per ping (for packet loss calculation) |
| `SPEEDTEST_INTERVAL_SECONDS` | `3600` | How often to run speed tests (default: 1 hour) |
| `SPEEDTEST_TIMEOUT_SECONDS` | `120` | Maximum time for a speed test before timeout |

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
|  |  Nginx   |----->| Effect-TS|----->|      QuestDB       |      |
|  | (port 80)|      | HTTP API |      |  (time-series DB)  |      |
|  |          |      | (port    |      |                    |      |
|  |          |      |  3001)   |      |                    |      |
|  +----+-----+      +----+-----+      +---------^----------+      |
|       |                 |                      |                 |
|       v                 v                      |                 |
|  Static Files      Ping Service ---------------+                 |
|  (Foldkit SPA)     Speedtest Service ----------+                 |
|                                                                  |
+------------------------------------------------------------------+
```

**Tech Stack:**
- **Frontend**: Foldkit + TypeScript + Vite + Tailwind CSS + ECharts
- **Backend**: Effect-TS HTTP platform (type-safe API with functional error handling)
- **Database**: QuestDB (columnar time-series database)
- **Process Manager**: Supervisord (manages all services in the container)
- **Reverse Proxy**: Nginx (serves frontend, proxies API requests)

## Dashboard Features

- **Live status**: Online, Degraded or Offline with a shape of its own, when it was last sampled, and your ISP and external IP. While an incident is running it names when it began, the failing hosts and the worst loss. The status and the incident line form one live region, so a screen reader announces a change from Online to Offline or Degraded. A status the latest fetch could not confirm reads No data rather than the last known state. Beneath it, the uptime and availability over the selected range, each with a signed change against the previous equal period ("worse", "better" or "steady", never colour alone), and the uptime over the last 24 hours, 7 days and 30 days with a note on how uptime differs from availability
- **Availability ribbon**: One cell per bucket of the selected range (up, degraded, down or no data; degraded is hatched, down struck through and no data dashed wherever a cell is wide enough to draw the pattern, while on a dense range such as 30 days a cell is about a pixel wide and reads by colour alone, with the incidents log and chips giving the same facts as text), with the incidents lettered above it in chips sized by duration; chips that would collide take a second row, and a run that still collides becomes one cluster chip that pins its first incident and lists the rest in the tooltip. Hovering, tapping or arrowing through the cells shows the bucket's time span, status and the share of each state, and a screen reader announces the same text. A cluster chip's label, tooltip and announcement also list each of its incidents. The ribbon is one tab stop: the arrow keys, Home and End move between cells and Escape clears the selection. On a phone the cells are 24 pixels tall in rows of 24, and a range of hourly buckets stacks into one row per day
- **Stat rail**: Median latency (with its 95th percentile), packet loss and jitter with their changes against the previous period, and the median download and upload with the number of tests behind them
- **Incidents**: A lettered log of the range's outages and degraded periods, newest first (start, end, duration, status, hosts, worst loss and peak latency), with totals. A range wider than 90 days shows the incidents of its newest 90 days. Below 1024 pixels each incident is a stacked card instead of a table row
- **Hosts**: Per-target status, p50, p95, loss, jitter and availability over the selected range, with a "No data" row for a configured host the range has no samples for
- **Latency Chart**: Ping times to each configured host
- **Packet Loss Chart**: Percentage of packets lost
- **Jitter Chart**: Network stability (variance in latency)
- **Incident marks**: Each incident in the log is shaded on the latency, packet loss and jitter charts and labelled with its log letter (the oldest incident is A)
- **Speed tests**: Download and upload speeds over time, with average and maximum figures and a button to run a test now
- **Overflow menu**: Light, Dark, or System theme, Run speed test, and Log out
- **Clock**: Times of day follow your locale's 12-hour or 24-hour clock everywhere
- **Errors**: A single banner with a Retry button reports any failed fetch while the last good data stays on screen. A card whose data could not load says so ("Could not load incidents.") instead of showing its empty-state text, and auto-refresh retries a failed fetch on its next tick while the card keeps saying so until the retry answers. Figures never outlive their range: after you change the range, a card shows its loading state until data for the new range arrives

### How connectivity status is classified

Every host is pinged together in one cycle, and the cycle as a whole is classified into exactly one state:

- **Up**: every host reachable and under 10% packet loss.
- **Degraded**: at least one host failed or exceeded 10% packet loss, but not all of them. There is no upper loss bound, so a reachable-but-lossy cycle is degraded however severe the loss.
- **Down**: every host in the cycle unreachable. One host failing out of several is a target or path problem, not a WAN outage.

The **uptime percentage** is deliberately "clean up only": it counts strictly *up* cycles over all cycles. Degraded cycles are still reachable but are **not** counted toward uptime, so packet loss lowers the uptime figure rather than being treated as full availability. The share of each state in a bucket is shown in the availability ribbon's tooltip.

The **live status** at the top of the dashboard answers "is the link up right now" and is independent of the selected date range. It reports the newest ping cycle inside a trailing window of two ping intervals (60 seconds at the default `PING_INTERVAL_SECONDS`, never shorter than 60 seconds) as **Online**, **Degraded** or **Offline**. An empty window reads as grey **No data**, with how long ago the last sample was taken. That means the monitoring process isn't running, which is a different fact from the internet being down.

### Data gaps vs. outages

A failed ping still records a row, with 100% packet loss and a `down` status. So an outage leaves a trail of data, and a stretch of time with no ping rows at all means something else: the monitor wasn't running. The dashboard keeps those two apart everywhere it can.

Uptime is measured only over the periods that were actually monitored. Alongside it the API reports a **coverage percentage**, how much of the selected window contains ping data, and the dashboard shows it in the footer. A window with no data at all reports no uptime figure at all, rather than 0%.

On the availability ribbon the two grey states mean different things. **No data**, drawn with dashed edges, is a gap after monitoring had already started. **Before monitoring started**, drawn as a solid grey cell and listed in the legend only when a cell has it, is the stretch that predates the first sample in the database.

**Date Range**: Quick buttons for the last hour, 24 hours, 7 days and 30 days, plus a calendar picker with presets (last 7 days, last 30 days, month to date, quarter to date, year to date, last 12 months, all time) and a two-month calendar for picking an arbitrary start and end day. All time starts at the first sample in the database; until that is known, or when the database has none, it shows the last 30 days and keeps asking on each refresh.

Charts support linked cursors (hovering on one chart highlights the same time on others) and automatic data aggregation: the bucket size is derived from the selected range's span, from 1-minute buckets for a range of 6 hours or less up to 1-day buckets beyond 90 days.

### Saved preferences

The theme, the selected date range, and whether auto-refresh is paused are stored in your browser's local storage (key `wan_monitor_settings`) and restored on the next visit. They're per-browser, not per-account, and nothing is sent to the server. The theme is Light, Dark, or System (the default), chosen from the overflow menu; System follows your operating system's light/dark preference and changes with it live, while an explicit Light or Dark choice always wins. A paused dashboard stays paused across reloads: the toolbar's pause button turns into a play button (named "Resume auto-refresh" for screen readers) and an "Auto-refresh paused" chip appears beside the live status. After two minutes without interaction auto-refresh also pauses on its own, with a "Paused after inactivity" chip, and any interaction resumes it; that pause is not saved. A custom (non-preset) date range is stored as absolute timestamps, so reopening the dashboard days later shows the same fixed window, not a rolling one. Clearing site data resets all three to defaults. Upgrading from an older version that only persisted theme resets it once, to your OS preference.

## Limitations

This tool monitors your internet connection **from the device running the container**. Keep in mind:

- **Local network issues affect readings**: If your WiFi is flaky or there's congestion on your LAN, this will show up in the metrics even if your WAN connection is fine.
- **Speed tests use bandwidth**: Each hourly speed test consumes actual bandwidth. On metered connections, consider increasing `SPEEDTEST_INTERVAL_SECONDS`.
- **Single vantage point**: This monitors from one location. It won't detect issues that only affect specific routes or destinations.
- **Designed for home/small office use**: Not intended for enterprise network monitoring.
- **Uptime is conditional on coverage**: A monitor that ran for one hour out of twenty-four can honestly report 100% uptime over roughly 4% coverage. Read the two numbers together; uptime alone says nothing about how much of the window it covers.
- **A stopped monitor leaves a gap, not an outage**: Time when the monitor wasn't running can't be backfilled, and it isn't counted as downtime.
- **A monitor that can't reach the database looks the same as a stopped one**: Both produce no rows, so the dashboard can't tell them apart.

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
- Frontend at http://localhost:3000
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
│   ├── web/                 # Foldkit frontend
│   │   ├── src/
│   │   │   ├── auth/        # Model/Message/update/view for login + session
│   │   │   ├── dashboard/    # Model/Message/update/view, charts, summary cards
│   │   │   └── api/         # Effect HTTP client against packages/shared schemas
│   │   └── ...
│   └── server/              # Effect-TS HTTP backend
│       ├── src/
│       │   ├── server/      # HTTP API routes and entry point
│       │   ├── services/    # Ping, speedtest, network monitor, auth
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
| `/api/connectivity-status/live` | GET | Current status from the newest ping cycle in a trailing window |
| `/api/connectivity-status/outages` | GET | Outage log: runs of non-up ping cycles, newest first (500 at most) |
| `/api/summary` | GET | Latency percentiles, loss and jitter for a range and the window before it, uptime for the last 24h/7d/30d, per-host stats, speed test summary |
| `/api/ping/trigger` | POST | Manually trigger a ping test |
| `/api/ping/hosts` | GET | Get configured ping hosts and the ping and speed test intervals |

Query parameters for `/api/metrics`:
- `startTime`: ISO timestamp
- `endTime`: ISO timestamp
- `granularity`: `1m`, `5m`, `15m`, `1h`, `6h`, `1d`
- `host`: Filter by specific ping host
- `source`: `ping` or `speedtest`. Filters to one measurement kind; aggregated queries need it to get one row per bucket

The summary and outage endpoints are read-only aggregates over the same `network_metrics` table. They take `startTime` and `endTime`, ISO 8601 timestamps with a time and a zone (`2024-02-10T08:00:00Z`). Both default to the trailing 24 hours. A malformed timestamp, one whose UTC instant falls outside years 0000 to 9999, a `startTime` after the `endTime`, a window wider than the endpoint allows (below), or (for `/api/summary`) a range so early that the equal-length window before it would begin before 1970-01-01 is rejected with a 400 before any query runs.

- `/api/summary`
  - `range` and `previous` carry `latencyP50` and `latencyP95` (percentiles of per-cycle latency, the mean across hosts, so they are approximate), `avgPacketLoss`, `avgJitter`, `uptimePercentage`, `availabilityPercentage` and `coveragePercentage`. `previous` is the window of equal length ending 1ms before the range starts, for deltas.
  - `windows.last24h`, `last7d` and `last30d` give uptime anchored at `endTime`.
  - `hosts` has one entry for each ping host with samples in the window, so a window with no data returns `hosts: []`. Its `availabilityPercentage` is the share of that host's ping samples that were answered; a lossy but answered sample counts as answered. `lastStatus` is the host's newest sample in the range: `down`, `degraded` (loss at or over the degraded floor) or `up`.
  - `speed` is in Mbps over successful tests (a stored 0 is a failed test): `downloadMedian` and `uploadMedian`, plus the test `count`.
- `/api/connectivity-status/outages` returns `data` and `meta`, and covers at most 90 days per request (`MAX_OUTAGE_SPAN_DAYS`); `meta.startTime` and `meta.endTime` are the window actually queried. An outage is a run of consecutive non-up ping cycles. Runs separated by a single missing cycle are merged (cycle spacing is measured from the window's own cycles, not assumed from the configured interval), and an up cycle always ends a run. Its `status` is the worst status in the run (`down` if any cycle was down, otherwise `degraded`), `affectedHosts` lists the hosts that failed or were lossy, and `end` is one ping cycle after the last non-up cycle, clipped to the range end.

## Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch
3. Make your changes with tests
4. Run `pnpm check` to ensure code quality
5. Submit a pull request

This project uses [Biome](https://biomejs.dev/) for linting and formatting. Pre-commit hooks will automatically check your code.

### Releasing

Releases are managed with [Changesets](https://github.com/changesets/changesets). If your PR should
appear in the changelog, run:

```bash
pnpm changeset
```

and follow the prompts to pick a bump type (patch/minor/major) and write a short release note. Commit the
generated `.changeset/*.md` file with your PR. CI checks that PRs against `main` carry a changeset, unless
labeled `no-changeset` (used for chores, docs, and dependency bumps).

Merging to `main` opens or updates a "Version Packages" PR; merging that PR bumps the version, updates
`CHANGELOG.md`, tags the release (`vX.Y.Z`), and publishes `phibit/wan-monitor` to Docker Hub.

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
 - Effect-TS (I wanted to try functional programming with a comprehensive type-safe HTTP platform)
 - QuestDB (I wanted to try a different time-series database)
 - Experimenting with a new AI-assisted dev workflow

Generally, taking this approach for a new project really accelerates learning and progress, although the process is manual, long, time-consuming, and interrupted by hours of manual research and documentation reading. However, because I ended up generating much of the code, I was effectively robbed of the experience of learning the frameworks and tools, and I ended up learning them in a much more passive way. There were major productivity gains, but by necessity they came at the expense of me improving my understanding :). Not something I'm mad about, just a general observation. I expect as these tools mature they will produce more layers of abstraction that will continue to improve productivity at the expense of understanding, as has been the general trend as tools and software development practices evolve, and probably a net positive!
