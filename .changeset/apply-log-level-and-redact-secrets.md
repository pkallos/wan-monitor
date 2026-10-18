---
"wan-monitor": minor
---

Apply LOG_LEVEL, keep the password and JWT secret out of logs, and ping once at boot instead of twice; startup now fails on an invalid LOG_LEVEL or a JWT_EXPIRES_IN with no unit (use 24h or 3600s, not 86400000)
