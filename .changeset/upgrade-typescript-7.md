---
"wan-monitor": patch
---

Upgrade TypeScript to 7.0.2 across the workspace, removing the now-deprecated `baseUrl` tsconfig option and adding explicit `@types/node` to apps/web for the new empty-by-default `types` array.
