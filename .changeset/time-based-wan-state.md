---
"wan-monitor": minor
---

Outages, uptime and the availability ribbon are now computed from each host's pings over time, so ping history recorded before 1.1.0 no longer shows thousands of zero-second outages. Uptime is now a share of monitored time. Each ping records its duration in a new `duration_ms` column, and `meta.observedCycles` (a cycle count) is replaced by `meta.observedSeconds`. `/api/summary` no longer returns the range's uptime, availability and coverage; `/api/connectivity-status` returns all three.
