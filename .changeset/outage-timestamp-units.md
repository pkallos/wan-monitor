---
"wan-monitor": patch
---

Fix outage durations that ran about a thousand ping cycles too long on databases whose metrics table has nanosecond timestamps, end each outage at the ping cycle that recorded its recovery, and add versioned startup migrations that rebuild such a table into the declared schema.
