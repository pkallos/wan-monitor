# WAN Monitor

WAN Monitor is a self-hosted dashboard for your internet connection. It pings a set of hosts to measure latency, packet loss and jitter, runs scheduled speed tests, stores the results in QuestDB and charts them over time.

![License](https://img.shields.io/badge/license-GPL--3.0-blue)


## What It Does

WAN Monitor runs on your local network and performs two kinds of test. The hosts and intervals are set in [Configuration](#configuration).

**Ping Monitoring**
- Sends ICMP pings to each host in `PING_HOSTS` every `PING_INTERVAL_SECONDS`
- Measures latency, packet loss and jitter
- Determines connectivity status (up, degraded or down)

**Speed Tests**
- Runs an Ookla speed test through `speedtest-net` every `SPEEDTEST_INTERVAL_SECONDS`
- Measures download and upload speed
- Captures the ISP name, the server location and your external IP

<img width="720" height="584" alt="image" src="https://github.com/user-attachments/assets/f8e52da7-31ee-4cbe-92e5-e694ed3deb29" />


## Quick Start with Docker

The Docker image bundles the dashboard, the API and QuestDB.

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
docker compose up -d
```

## Configuration

All configuration is done via environment variables.

### Monitoring Settings

| Variable | Default | Description |
|----------|---------|-------------|
| `PING_HOSTS` | `8.8.8.8,1.1.1.1,cloudflare.com` | Comma-separated hosts to ping |
| `PING_INTERVAL_SECONDS` | `30` | How often to run ping tests, as a positive whole number of seconds. Reports also hold each host's ping spacing between half and twice this value (see How connectivity status is classified). |
| `PING_TIMEOUT` | `5` | Ping timeout in seconds |
| `PING_TRAIN_COUNT` | `10` | Number of packets per ping (for packet loss calculation) |
| `SPEEDTEST_INTERVAL_SECONDS` | `3600` | How often to run speed tests |
| `SPEEDTEST_TIMEOUT_SECONDS` | `120` | Longest time, in seconds, a speed test may run before the speedtest CLI is stopped. In the Docker image, nginx ends a `POST /api/speedtest/trigger` request after 300 seconds, and that cancels the test. Keep this value below 300 for manual tests; scheduled tests are unaffected. |

### Authentication

| Variable | Default | Description |
|----------|---------|-------------|
| `WAN_MONITOR_USERNAME` | `admin` | Login username |
| `WAN_MONITOR_PASSWORD` | *(empty)* | Login password. **If empty, authentication is disabled.** |
| `JWT_SECRET` | *(random per start)* | Secret for signing tokens. When unset, a random secret is generated at each start and sessions end on restart. Set it whenever a password is set; a fixed secret keeps sessions across restarts. |
| `JWT_EXPIRES_IN` | `24h` | How long login sessions last: a number with a unit, such as `90m`, `24h` or `7d`. A bare number such as `3600`, or any other value, stops the server at startup. |

If a session is stored and the server cannot be reached when the dashboard loads, the browser keeps the session and shows "Cannot reach the server" with Retry and Sign out buttons. The session continues if the token is still valid when the server answers; only a rejected token or Sign out ends it.

### Server & Database

| Variable | Default | Description |
|----------|---------|-------------|
| `SERVER_HOST` | `0.0.0.0` | Interface the backend API listens on |
| `SERVER_PORT` | `3001` | Backend API port (internal) |
| `LOG_LEVEL` | `info` | Minimum level to log: trace, debug, info, warn, error, fatal (any case). Any other value stops the server at startup. |
| `DB_HOST` | `localhost` | QuestDB host |
| `DB_PORT` | `9000` | QuestDB HTTP port |
| `DB_PG_PORT` | `8812` | QuestDB PostgreSQL wire port |
| `DB_QUERY_TIMEOUT` | `25000` | Longest time, in milliseconds, that a database query, a wait for a free database connection or the connection health check may take before failing. Must be a positive whole number, or the server stops at startup. Raise it if long date ranges over a large history fail with a timeout. The dashboard refreshes every 30 seconds, so a value above 30000 lets refreshes overlap when queries are slow. |

The server reads a few more database tuning variables (`DB_PROTOCOL`, `DB_TABLE`, `DB_AUTO_FLUSH_ROWS`, `DB_AUTO_FLUSH_INTERVAL`, `DB_REQUEST_TIMEOUT` and `DB_RETRY_TIMEOUT`). Their defaults are in `apps/server/src/infrastructure/config/config.ts`.

### Database schema and migrations

The server manages the `network_metrics` table itself. Each time it connects to QuestDB, it applies any migrations the database has not had yet and records them in the `network_metrics_migrations` table. Snapshot the QuestDB volume before upgrading.

- **v1** creates the table on a new install.
- **v2** rebuilds a table whose column types or timestamp format do not match what the server expects. It checks that the copy is complete before it drops the original, and needs free disk space of about 1.3 times the table's size while it runs. No pings are recorded during the rebuild, and `/api/health/ready` names the step in progress. An interrupted rebuild resumes on the next start.
- **v3** clears speed test download and upload values stored as 0, so they count as no reading.
- **v4** adds the `duration_ms` column: how long a ping ran, in milliseconds, counted from its `timestamp`, the moment the ping started. Earlier ping rows and all speed test rows hold no value there.

If a migration cannot finish safely, the server does not connect, and its log says why and how to fix it. It retries every 10 minutes, or immediately after a restart. The server never deletes a column on its own.

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
- **Backend**: Effect-TS HTTP platform
- **Database**: QuestDB
- **Process Manager**: Supervisord
- **Reverse Proxy**: Nginx

## Dashboard Features

- **Live status**: Online, Degraded or Offline, each with its own shape, plus when the monitor last checked and your ISP and public IP. During an incident it shows when the incident began and the packet loss of the failing hosts, and a screen reader announces each status change. When the latest fetch could not confirm the status, the status reads No data. Below the status are the uptime over the selected range, the incident totals for the range, and the uptime over the last 24 hours, 7 days and 30 days. When the monitor has data for only part of the range, a line says how much of the range the uptime covers.
- **Availability ribbon**: One cell per bucket of the selected range, colored up, degraded, down, no data or before monitoring started. Where a cell is wide enough, degraded is hatched, down is struck through and no data is dashed; on a dense range such as 30 days, cells read by color alone. Lettered chips above the ribbon mark the incidents and are sized by duration; chips that would collide move to a second row or merge into a cluster chip that lists its incidents. Hovering, tapping or arrowing to a cell shows its time span, its status and the share of its time in each state, and a screen reader announces the same text. The subtitle gives the length of a cell. The ribbon is one tab stop: the arrow keys, Home and End move between cells, and Escape clears the selection. On a phone, the ribbon wraps into rows of 24 cells, with each cell 24 pixels tall, and hourly buckets stack one row per day.
- **Stat rail**: Median latency with its 95th percentile; packet loss and jitter averaged over every ping; and the median download and upload with the number of tests behind them
- **Incidents**: A lettered log of the range's outages and degraded periods, newest first, with start, end, duration, status, hosts, worst loss and peak latency, and a sentence of totals. A range wider than 90 days shows the incidents of its newest 90 days. On screens under 1024 pixels wide, each incident is a stacked card.
- **Hosts**: Status, p50, p95, loss, jitter and the share of pings answered for each host over the selected range, and the ping interval. A configured host with no samples in the range gets a "No data" row.
- **Latency chart**: The median (p50) of each bucket, with its 95th percentile as a band above it, an average line at the mean of the plotted medians, and a dashed 50 ms reference line. The All hosts / Per host control switches the chart to one line per host and is remembered. Drag across the chart with a mouse to narrow the whole page to that span (at least five minutes); Reset range goes back, and a reload opens on the range from before the drag.
- **Packet loss chart**: One bar per bucket, with a dashed line at 10%, the loss at which a sample counts as degraded
- **Jitter chart**: Variation in latency, with a 10 ms reference line
- **Reference lines**: A reference line appears only once the plotted data reaches it
- **Zoom**: Ctrl with the mouse wheel, or a trackpad pinch, zooms the latency, packet loss and jitter charts together. From the keyboard, use the range presets and the date picker in place of dragging or zooming.
- **Incident marks**: The latency, packet loss and jitter charts shade each incident in the log and label it with its log letter, starting from A for the oldest. A line marks each incident's start, solid for down and dashed for degraded. Incidents too close together to label separately share one label for the span, such as A–C.
- **Chart text and states**: Each chart is a group labeled with its name, and a screen reader reads its plot as an image whose name gives the range and the average and highest bucket values. Those bucket figures can differ from the stat rail, which averages over every ping in the range. A one-line message replaces the plot when the range has no data or only one bucket, or when its data fails to load. Charts do not animate when your operating system asks for reduced motion.
- **Speed tests**: Download as circles and upload as diamonds, each with a median line and average and maximum figures. A thin line joins the points when they come hourly or more often. The subtitle gives the test interval from `SPEEDTEST_INTERVAL_SECONDS`. Under 7 days, each test is its own point, and a caption under the figures describes the newest test. From 7 days up, each point is the average of the tests in an hourly, 6-hour or daily bucket, and a note says so. A button runs a test now.
- **Date range**: Quick buttons for the last hour, 24 hours, 7 days and 30 days, plus a calendar picker with presets (last 7 days, last 30 days, month to date, quarter to date, year to date, last 12 months, all time) and a two-month calendar for picking any start and end day. All time starts at the first sample in the database. Until the first sample is known, or when there is none, All time shows the last 30 days, and the dashboard checks again on each refresh.
- **Linked cursor**: Hovering on one chart highlights the same time on the others
- **Bucket size**: Follows the selected range, from 1-minute buckets for a range of 6 hours or less up to 1-day buckets beyond 90 days
- **Overflow menu**: Theme (Light, Dark or System), Run speed test and Log out
- **Clock**: Times of day follow your locale's 12-hour or 24-hour clock
- **Errors**: A failed fetch shows one banner with a Retry button, and data already loaded for the selected range stays on screen. A card whose data could not load says so instead of showing its empty state, and auto-refresh retries on its next tick. After a range change, each card shows its loading state until data for the new range arrives.

### How connectivity status is classified

Each host's newest ping stands for that host until the host's next ping. A host's spacing is the median of the gaps between its last few pings, ignoring gaps under 1 second. Before the host has any gaps to measure, its spacing is `PING_INTERVAL_SECONDS`. Spacing is held between half and twice `PING_INTERVAL_SECONDS`. Rows spaced much wider than twice the interval, such as 15-minute rows at the default 30-second interval, therefore each stand for at most a minute, and a run of failed rows reads as separate short outages. These bounds follow the current `PING_INTERVAL_SECONDS`, so history recorded at another interval is read against them: history recorded every 300 seconds and read at 30 seconds is mostly no data, and history recorded every 30 seconds and read at 300 seconds bridges longer gaps. If the next ping comes more than 2.5 spacings after the previous one, the old one stands for one spacing and then lapses. A host that is not in `PING_HOSTS`, such as a manual ping of another name, bridges less: its ping stands until that host's next ping only when one follows within 1.5 spacings, and otherwise for one spacing.

At any moment, the hosts with a standing ping set the state:

- **Up**: every one answered, with under 10% packet loss.
- **Degraded**: at least one failed or reached 10% packet loss, and at least one answered. Any loss from 10% up counts, however high.
- **Down**: every one failed.

A state shorter than half a spacing is shorter than the pings can resolve, and it takes the state before it. After a gap in the data, any short states at the start of the new run of pings take the state of the first stretch in that run that lasts at least half a spacing or reaches the present. If no stretch does, they take the state of the longest stretch in the run. A state that reaches the present is never folded into the one before it, so an onset or a recovery shows at once.

An **outage** is an unbroken stretch of degraded or down time; the dashboard also calls it an incident. An outage's hosts are the hosts that failed or reached 10% packet loss for at least half a spacing within the outage, or for all of it when the outage is shorter than half a spacing.

**Uptime** is the share of monitored time that was up, and **availability** also counts degraded time. Each cell of the availability ribbon splits its own monitored time into up, degraded and down time and takes its color from the split: down if it holds any down time, degraded if at least 5% of its monitored time was degraded, and up otherwise.

The **live status** applies the same rules at the current moment, whatever range is selected, and reads **Online**, **Degraded** or **Offline**. With no standing ping it reads gray **No data** and shows how long ago the last ping was taken.

### Data gaps vs. outages

A failed ping records a row with 100% packet loss and a `down` status. Time with no standing ping is a gap: it ends an outage, and uptime and availability leave it out.

The API also reports a **coverage percentage**: the share of the range's ribbon cells that hold any monitored time. The dashboard shows coverage beside the uptime figure when coverage is under 100%. A range with no data has no uptime figure, rather than 0%.

The availability ribbon has two gray states. **No data**, drawn with dashed edges, is a gap after monitoring started. The **Before monitoring started** state, a solid gray cell, covers the time before the first sample in the database; the legend lists it only when the ribbon contains one.

### Saved preferences

The theme, the selected date range, whether auto-refresh is paused, and the latency chart's All hosts / Per host choice are stored in your browser's local storage under `wan_monitor_settings` and restored on the next visit. Nothing is sent to the server. The theme is Light, Dark or System (the default, which follows your operating system), chosen from the overflow menu. A custom (non-preset) date range is stored as absolute timestamps, so reopening the dashboard days later shows the same fixed window. Auto-refresh pauses on its own after two minutes without interaction, with a "Paused after inactivity" chip; any interaction resumes it. A pause you set yourself is saved, but this automatic pause is not. Clearing site data resets all four to defaults.

## Limitations

This tool monitors your internet connection **from the device running the container**. It is designed for home and small-office use.

- **Local network issues affect readings**: Flaky WiFi or congestion on your LAN shows up in the metrics even when your WAN connection is fine.
- **Speed tests use bandwidth**: Each speed test consumes actual bandwidth, so raise `SPEEDTEST_INTERVAL_SECONDS` on a metered connection. Only one test runs at a time, so a scheduled test that comes due during a manual one waits and runs right after it.
- **Single vantage point**: This monitors from one location. It won't detect issues that only affect specific routes or destinations.
- **Read uptime with coverage**: A monitor that ran for one hour out of 24 reports 100% uptime at about 4% coverage when that hour was all up.
- **A stopped monitor leaves a gap, not an outage**: Time with no standing ping, such as a stop longer than 2.5 spacings, is a gap and is not counted as downtime. A shorter stop is bridged.
- **A monitor that can't reach the database looks the same as a stopped one**: Both produce no rows, so the dashboard can't tell them apart.

## Development Setup

### Prerequisites

- Node.js and pnpm at the versions in `.nvmrc` and `package.json` (`engines`, `packageManager`)
- Docker, to run QuestDB locally

### Getting Started

```bash
git clone https://github.com/pkallos/wan-monitor.git
cd wan-monitor
nvm use
pnpm install
pnpm start:dev
```

This starts:
- Frontend at http://localhost:3000
- Backend API at http://localhost:3001
- QuestDB at http://localhost:9000 (web console)

To override the defaults, copy `.env.example` to `.env.local`. Values in `.env.local` take precedence over `.env`.

### Development Commands

Scripts live in `package.json`. These are the ones you need most:

```bash
pnpm start:dev      # QuestDB, frontend and backend
pnpm db:up          # QuestDB only
pnpm dev:web        # frontend only
pnpm dev:server     # backend only
pnpm test           # unit tests
pnpm test:e2e       # Playwright tests
pnpm lint
pnpm format
pnpm typecheck
pnpm build
```

### Project Structure

```
wan-monitor/
├── apps/
│   ├── web/                 # Foldkit frontend
│   └── server/              # Effect-TS HTTP backend
├── packages/
│   └── shared/              # Shared types and schemas
├── e2e/                     # Playwright tests
├── scripts/                 # Release, setup and smoke-test scripts
├── docker/                  # Production nginx and supervisord configs
├── docs/effect-ts/          # Effect-TS patterns used in the code
├── Dockerfile               # Multi-stage production build
└── docker-compose.yml       # Development database
```

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/health/live` | GET | Liveness: the server process is up |
| `/api/health/ready` | GET | Readiness: QuestDB is connected and migrations have finished |
| `/api/auth/status` | GET | Check if auth is required |
| `/api/auth/login` | POST | Log in and receive a JWT |
| `/api/auth/logout` | POST | Log out; the server only acknowledges the request |
| `/api/auth/me` | GET | The signed-in username and whether authentication is enabled |
| `/api/metrics` | GET | Query ping and speedtest data |
| `/api/metrics/earliest` | GET | Timestamp of the oldest stored row, or `null` when there is none |
| `/api/connectivity-status` | GET | Aggregated up/down/degraded status, with uptime, availability and coverage for the range |
| `/api/connectivity-status/live` | GET | Current status from each host's newest ping (see How connectivity status is classified) |
| `/api/connectivity-status/outages` | GET | Outage log, newest first (500 at most) |
| `/api/summary` | GET | Latency percentiles, loss and jitter for a range, uptime for the last 24h/7d/30d, per-host stats, speed test summary |
| `/api/ping/trigger` | POST | Manually trigger a ping test |
| `/api/ping/hosts` | GET | Get configured ping hosts and the ping and speed test intervals |
| `/api/speedtest/trigger` | POST | Run a speed test now. The endpoint answers `SPEED_TEST_ALREADY_RUNNING` while any test, scheduled or manual, is running |
| `/api/speedtest/status` | GET | Whether a speed test, scheduled or manual, is running |
| `/api/speedtest/history` | GET | Stored speed tests for a range |

Query parameters for `/api/metrics`:
- `startTime`: ISO 8601 timestamp; one hour before `endTime` when omitted
- `endTime`: ISO 8601 timestamp; the current time when omitted
- `limit`: Positive integer, the most rows to return
- `granularity`: `1m`, `5m`, `15m`, `1h`, `6h`, `1d`
- `host`: Filter by specific ping host
- `source`: `ping` or `speedtest`, which filters to one measurement kind. Aggregated queries need `source` to get one row per bucket
- `percentiles`: `p50-p95` (the default) or `p50`. With `p50`, aggregated rows omit `latency_p95` and the query skips a pass over the window

With a `granularity`, each ping row also carries `latency_p50` and `latency_p95`, approximate percentiles over the pings in its bucket. Bucket averages for latency, jitter and packet loss are means over those pings.

Reports treat a resolved name, such as the target of a monitored host's CNAME, as a host outside `PING_HOSTS`. Older history can hold such rows, because earlier versions stored an answered ping under the resolved name. Stored rows carry one of three timestamps: the time the ping ended (versions before 1.1.0), one stamp shared by the hosts pinged together (1.1.0 up to the release that added `duration_ms`), or the time the ping started (rows with a `duration_ms`). Reports read every kind of row by the same rules.

Every endpoint that takes a range reads `startTime` and `endTime` as ISO 8601 timestamps with a time and a zone (`2024-02-10T08:00:00Z`): `/api/metrics`, `/api/speedtest/history`, `/api/connectivity-status`, `/api/summary` and `/api/connectivity-status/outages`. A missing `endTime` defaults to the current time. A missing `startTime` trails the `endTime` by one hour for `/api/metrics` and `/api/speedtest/history`, and by 24 hours for the other three.

A request is rejected with a 400 before any query runs when it has any of these: a malformed timestamp, a timestamp whose UTC instant falls outside years 0000 to 9999, a `startTime` after the `endTime`, a `limit` that is not a positive integer, or a window wider than the endpoint allows (below). The server answers a reversed range with the `InvalidTimeRange` error, and a malformed value fails request decoding.

The data endpoints (`/api/metrics`, `/api/metrics/earliest`, `/api/speedtest/history`, `/api/connectivity-status`, `/api/connectivity-status/live`, `/api/connectivity-status/outages` and `/api/summary`) answer a `503` with `DbUnavailable` when QuestDB is unreachable and a `500` with `InternalError` when a query fails for any other reason. Both of those bodies are `{ "_tag": ..., "message": ... }` with a fixed message, and the cause of a `500` is logged on the server only.

- `/api/summary`
  - `range` carries `latencyP50` and `latencyP95` (approximate percentiles over every ping in the range), `avgPacketLoss` and `avgJitter`. Uptime, availability and coverage for the selected range come from `/api/connectivity-status`.
  - `windows.last24h`, `last7d` and `last30d` give uptime anchored at `endTime`.
  - `hosts` has one entry for each ping host with samples in the window, so a window with no data returns `hosts: []`. Each entry's `availabilityPercentage` is the share of that host's ping samples that were answered; a lossy but answered sample counts as answered. `lastStatus` is the status of the host's newest sample in the range: `down`, `degraded` (loss of 10% or more) or `up`.
  - `speed` is in Mbps over tests that took a reading (an absent figure or a stored 0 is no reading): `downloadMedian` and `uploadMedian`, plus the test `count`.
- `/api/connectivity-status/outages` returns `data` and `meta` and accepts a window of at most 90 days (`MAX_OUTAGE_SPAN_DAYS`); `meta.startTime` and `meta.endTime` are the window queried, with defaults applied. Outages, their `status` and `affectedHosts` follow How connectivity status is classified; `start` and `end` are clipped to the window and to the present.

## Contributing

To contribute:

1. Fork the repository
2. Create a feature branch
3. Make your changes with tests
4. Run `pnpm lint`, `pnpm format:check`, `pnpm test`, `pnpm typecheck` and `pnpm build`; CI runs these and more (`.github/workflows/ci.yml`)
5. Submit a pull request

This project uses [Biome](https://biomejs.dev/) for linting and formatting. A pre-commit hook runs Biome on staged files, and a pre-push hook runs `pnpm typecheck`.

### Releasing

Releases are managed with [Changesets](https://github.com/changesets/changesets). If your PR should
appear in the changelog, run:

```bash
pnpm changeset
```

Then follow the prompts to pick a bump type (patch, minor or major) and write a short release note. Commit the
generated `.changeset/*.md` file with your PR. A PR with no release-worthy effect (chores, docs, dependency
bumps) takes the `no-changeset` label instead.

Merging to `main` opens or updates a release PR titled "chore: release wan-monitor". That release PR, once merged, bumps the
version, updates `CHANGELOG.md`, tags the release (`vX.Y.Z`) and publishes `phibit/wan-monitor` to Docker Hub.

## License

This project is licensed under the GNU General Public License v3.0 (GPL-3.0). See the [LICENSE](LICENSE) file for details.
