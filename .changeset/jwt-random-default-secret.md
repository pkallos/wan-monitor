---
"wan-monitor": patch
---

Sign sessions with a random secret generated at each start, instead of a public default, when JWT_SECRET is unset; installs that set a password without JWT_SECRET now log users out on every restart until it is set. Login credentials are compared in constant time.
