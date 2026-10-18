---
"wan-monitor": minor
---

Treat speed tests that older versions stored as 0 as missing readings in averages, the speed chart and the last-test label, and add DB_QUERY_TIMEOUT (25 seconds by default) so long date ranges over a large history no longer fail at 5 seconds
