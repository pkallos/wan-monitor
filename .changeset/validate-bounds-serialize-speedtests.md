---
"wan-monitor": patch
---

Reject malformed or reversed time ranges and bad limits with a 400 on the metrics, speed test history and connectivity status routes, run speed tests one at a time and stop the speedtest CLI when a test times out, and leave a missing speed test measurement empty instead of storing 0.
