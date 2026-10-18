---
"wan-monitor": minor
---

Return data endpoint errors as tagged JSON bodies (a 503 is now `{ _tag: "DbUnavailable", message }`, and a 500 is `InternalError` without database error text), and fail a query whose stored rows don't match the declared schema instead of coercing them
