---
"wan-monitor": patch
---

Stop slow queries from taking the API offline, keep pinging when QuestDB drops mid-write, flush pending metrics when the server is stopped, and log lost ping writes instead of counting them as failed pings.
