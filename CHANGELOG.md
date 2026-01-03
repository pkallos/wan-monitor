# Changelog

## [0.5.4](https://github.com/pkallos/wan-monitor/compare/wan-monitor-v0.5.3...wan-monitor-v0.5.4) (2026-01-03)


### Bug Fixes

* use environment variables for QuestDB logging with proper inheritance ([#103](https://github.com/pkallos/wan-monitor/issues/103)) ([5300ae8](https://github.com/pkallos/wan-monitor/commit/5300ae8bde38b6ebbfe255236f2d545a5ee6ff82))


### Performance Improvements

* reduce DOM overhead in ConnectivityStatusChart and add dynamic granularity ([#106](https://github.com/pkallos/wan-monitor/issues/106)) ([f4b072c](https://github.com/pkallos/wan-monitor/commit/f4b072c3790fdad39457638e07c44c15719fe87c))
* remove per-point toLocaleTimeString in ping chart data shaping ([#105](https://github.com/pkallos/wan-monitor/issues/105)) ([e2bd2dc](https://github.com/pkallos/wan-monitor/commit/e2bd2dcbd36bb3db1277e7b9d458c37b270dc84a))

## [0.5.3](https://github.com/pkallos/wan-monitor/compare/wan-monitor-v0.5.2...wan-monitor-v0.5.3) (2026-01-03)


### Performance Improvements

* optimize Docker build caching by restructuring layer order ([28d9cf4](https://github.com/pkallos/wan-monitor/commit/28d9cf4bf0e4ac94befb125e49cdde77cecc36bc))
* optimize Docker build caching by restructuring layer order ([6fd0985](https://github.com/pkallos/wan-monitor/commit/6fd0985a4e75739b9aac1fd3118c227b41549e5c))

## [0.5.2](https://github.com/pkallos/wan-monitor/compare/wan-monitor-v0.5.1...wan-monitor-v0.5.2) (2026-01-03)


### Bug Fixes

* suppress QuestDB INFO logs via log.conf file ([dce2510](https://github.com/pkallos/wan-monitor/commit/dce2510d5ac2aea11ffac5aee9dc146173775981))
* suppress QuestDB INFO logs via log.conf file ([2cc4c7d](https://github.com/pkallos/wan-monitor/commit/2cc4c7df5a756c210518f9d43452bccbface5341))

## [0.5.1](https://github.com/pkallos/wan-monitor/compare/wan-monitor-v0.5.0...wan-monitor-v0.5.1) (2026-01-03)


### Bug Fixes

* use QDB_LOG_W_STDOUT_LEVEL env var for QuestDB log suppression ([#80](https://github.com/pkallos/wan-monitor/issues/80)) ([e61cd25](https://github.com/pkallos/wan-monitor/commit/e61cd25d885a867443da2a253f178781a764ef96))


### Performance Improvements

* improve Docker build caching to avoid repeated native recompiles ([#79](https://github.com/pkallos/wan-monitor/issues/79)) ([6e489c0](https://github.com/pkallos/wan-monitor/commit/6e489c0d03978c06e544110a631451481a3e2575))

## [0.5.0](https://github.com/pkallos/wan-monitor/compare/wan-monitor-v0.4.0...wan-monitor-v0.5.0) (2026-01-02)


### Features

* integrate code coverage reporting (Vitest) into CI ([aba09f8](https://github.com/pkallos/wan-monitor/commit/aba09f822a20870bf7d7864af814a0567419b42b))
* integrate code coverage reporting (Vitest) into CI ([78f6ca7](https://github.com/pkallos/wan-monitor/commit/78f6ca792ffff081dbd0f8e10af580a492f0645a))
* redesign QuestDB connection manager for runtime reliability ([6edd248](https://github.com/pkallos/wan-monitor/commit/6edd248d5699332d5b9e74256a4354c0d1cadf65))
* redesign QuestDB connection manager for runtime reliability ([3234031](https://github.com/pkallos/wan-monitor/commit/32340318700ed28567c65fe3cdfaf5886f3b7999))


### Bug Fixes

* correct packet loss aggregation and add separate speedtest history endpoint ([f37dd0a](https://github.com/pkallos/wan-monitor/commit/f37dd0a7090fcd600d82a752ddeb35035cac1ec8))
* correct packet loss aggregation and add separate speedtest history endpoint ([e57bf0a](https://github.com/pkallos/wan-monitor/commit/e57bf0a6d362055a18383e70cd00040ff2b02bec))
* pin speedtest-net to exact version for patch compatibility ([0749509](https://github.com/pkallos/wan-monitor/commit/07495091dc1d2c3b6de1626fae996e0bec1a6b94))
* pin speedtest-net to exact version for patch compatibility ([b9479ab](https://github.com/pkallos/wan-monitor/commit/b9479ab0e168eb994297eaa97e2cac2412358838))

## [0.4.0](https://github.com/pkallos/wan-monitor/compare/wan-monitor-v0.3.0...wan-monitor-v0.4.0) (2026-01-01)


### Features

* add Biome Grit lint rule to enforce @/ path alias over relative imports ([b923fba](https://github.com/pkallos/wan-monitor/commit/b923fbaf71487d09fbc5d8db7c82830a1dedeee8))
* add Biome Grit lint rule to enforce @/ path alias over relative imports ([816d56d](https://github.com/pkallos/wan-monitor/commit/816d56da0be66204e1bbfb0f8d0236c559a2a776))
* add dark mode support to dashboard ([7ead1e7](https://github.com/pkallos/wan-monitor/commit/7ead1e769a9a1f243575df6fe88dedb2fbc4a1d5))
* add manual speed test trigger button to dashboard ([f742dfe](https://github.com/pkallos/wan-monitor/commit/f742dfe024703049e1ad78d35ca80d012e81cded))
* add manual speed test trigger button to dashboard ([ff31450](https://github.com/pkallos/wan-monitor/commit/ff31450f19e804d64d0dcd56aa76c27cd1522b7d))
* enforce hard timeout for speedtest execution ([16aab52](https://github.com/pkallos/wan-monitor/commit/16aab526bcafc3a455cffaffe5594756cd3d6d9c))
* enforce hard timeout for speedtest execution ([b1fc418](https://github.com/pkallos/wan-monitor/commit/b1fc41867eea52d302bd08149852fbf4062ecae6))
* split liveness and readiness health endpoints + add QuestDB startup retry ([e2b10db](https://github.com/pkallos/wan-monitor/commit/e2b10db88110273b1b52e6349639e70a33db3f6b))
* split liveness and readiness health endpoints + add QuestDB startup retry ([410bb5e](https://github.com/pkallos/wan-monitor/commit/410bb5ecea4010e2050f16721d3db42623d1880c))

## [0.3.0](https://github.com/pkallos/wan-monitor/compare/wan-monitor-v0.2.0...wan-monitor-v0.3.0) (2026-01-01)


### Features

* display ISP and IP address information in dashboard (PHI-59) ([44d5f17](https://github.com/pkallos/wan-monitor/commit/44d5f1773674f5d76ee9fe698e2d5da3c6f8447c))
* display ISP and IP address information in dashboard (PHI-59) ([cd52758](https://github.com/pkallos/wan-monitor/commit/cd527587c0e5c7dacbefff73ffa20f9088234ce6))

## [0.2.0](https://github.com/pkallos/wan-monitor/compare/wan-monitor-v0.1.0...wan-monitor-v0.2.0) (2026-01-01)


### Features

* add auto-refresh to dashboard with pause/resume toggle ([629c2aa](https://github.com/pkallos/wan-monitor/commit/629c2aafd8611dfc3696cd591a0ae389e43851ff))
* add auto-refresh to dashboard with pause/resume toggle ([1e540e9](https://github.com/pkallos/wan-monitor/commit/1e540e939364fd5feca0747d9f4b809a8cdeb958))
* add basic authentication to dashboard UI ([ea07a62](https://github.com/pkallos/wan-monitor/commit/ea07a624cdcf7483ca08e41511c9c404dcbb269f))
* add basic authentication to dashboard UI ([55ffd30](https://github.com/pkallos/wan-monitor/commit/55ffd30fce5ce8fd2c11585f95a359fc0918f3e8))
* add ConnectivityStatusChart showing up/down/degraded history ([f9d2f3c](https://github.com/pkallos/wan-monitor/commit/f9d2f3cc3ab6133dc03d12390a7b5d7384d42269))
* add ConnectivityStatusChart showing up/down/degraded history ([84d3184](https://github.com/pkallos/wan-monitor/commit/84d3184c3ab3d686f1eb559b14fc34e6c9af88ac))
* add DateRangeSelector component with time filtering ([a9e60a1](https://github.com/pkallos/wan-monitor/commit/a9e60a122e5c14f86524246fea1630dc463ed478))
* add DateRangeSelector component with time filtering ([c306221](https://github.com/pkallos/wan-monitor/commit/c30622179b5817724ab7cc494ae284ca7ac61d3a))
* add JitterChart with stability metrics ([8438ece](https://github.com/pkallos/wan-monitor/commit/8438ece8df76c04de6c88067dce0ad8345db4b91))
* add JitterChart with stability metrics (PHI-36) ([72cf666](https://github.com/pkallos/wan-monitor/commit/72cf666f6fdfbbbcd67e0ed853931c7b3f27be52))
* add NetworkMonitor service with Effect Schedule ([d39faf8](https://github.com/pkallos/wan-monitor/commit/d39faf8b94322a47f4a92726964cd285364e142a))
* add PacketLossChart with threshold zones ([070fa31](https://github.com/pkallos/wan-monitor/commit/070fa313ee8a73ad2627c76627d572c40e582996))
* add PacketLossChart with threshold zones (PHI-35) ([240ce1b](https://github.com/pkallos/wan-monitor/commit/240ce1b2f65508ae868dec447a7100190728c9a9))
* add PingExecutor service to write ping results to QuestDB (PHI-17) ([e1e14a8](https://github.com/pkallos/wan-monitor/commit/e1e14a8ae51b881757c73387f469dfea8978bcdf))
* add PingExecutor service to write ping results to QuestDB (PHI-17) ([98e8239](https://github.com/pkallos/wan-monitor/commit/98e823976df5326c70ac33589598efef8feb7572))
* add React Query and API client for ping metrics data fetching ([259e12a](https://github.com/pkallos/wan-monitor/commit/259e12a256a000e5183360f828f68c6c36db601e))
* add React Query and API client for ping metrics data fetching ([253a91f](https://github.com/pkallos/wan-monitor/commit/253a91f6ed7056e9a60f9f6b7c630bb978ee7691))
* add Recharts components with Chakra UI theme integration ([936fafa](https://github.com/pkallos/wan-monitor/commit/936fafa88f6ac67fd70cdc56649a3bbbf6a486cc))
* add Recharts components with Chakra UI theme integration ([d92c243](https://github.com/pkallos/wan-monitor/commit/d92c2431afbb3836ef7e366d8a43e2f49138d0b9))
* add Release Please and Docker publish workflows ([07f6af0](https://github.com/pkallos/wan-monitor/commit/07f6af0e8018fa6a002792885cb6848110d46ab7))
* add Release Please and Docker publish workflows ([89c7efe](https://github.com/pkallos/wan-monitor/commit/89c7efe0af58b8e6cff7008a39ed9a9b9cbd169a))
* add REST API endpoint to query ping metrics from QuestDB (PHI-16) ([465b435](https://github.com/pkallos/wan-monitor/commit/465b435563d07bd06eaf5d064a2acc541fc1f3d7))
* add REST API endpoint to query ping metrics from QuestDB (PHI-16) ([8101cba](https://github.com/pkallos/wan-monitor/commit/8101cba71d47804cc299c0231b88a9f8f89b9ee2))
* add speed test chart and verify speedtest latency/jitter data flow ([222b261](https://github.com/pkallos/wan-monitor/commit/222b26198dddddecc2897c67356f51c4f9150780))
* add speed test chart and verify speedtest latency/jitter data flow ([c961fad](https://github.com/pkallos/wan-monitor/commit/c961fad0dbbfae4a10b40c4144ed79131bcca7a6))
* add SQL escape helpers and refactor queryMetrics to prevent SQL injection ([852b7a6](https://github.com/pkallos/wan-monitor/commit/852b7a62fb04fa4f348da03386ce2ea082e5e45b))
* add VSCode config for Biome lint/format integration ([1c1b05c](https://github.com/pkallos/wan-monitor/commit/1c1b05c3595d9cd781de422bc288284549e1ad06))
* add VSCode config for Biome lint/format integration ([deea04d](https://github.com/pkallos/wan-monitor/commit/deea04d84b56f6680b6db8f3a536e0693ee8b835))
* create all-in-one production Docker image (PHI-10) ([1b87803](https://github.com/pkallos/wan-monitor/commit/1b87803fa6c0d1e1dd967b95c4c9e409c9c0a1dc))
* create all-in-one production Docker image (PHI-10) ([b31f52f](https://github.com/pkallos/wan-monitor/commit/b31f52fcdcbb27ca104ba6b1f99c3fec99f6d086))
* create dashboard layout with metric cards grid ([747d8ed](https://github.com/pkallos/wan-monitor/commit/747d8edbe3090a44f498fcb7de2e5c9fc096bad0))
* create dashboard layout with metric cards grid ([75c8210](https://github.com/pkallos/wan-monitor/commit/75c82109de60e891284f445f9dcd76fc933ea304))
* create LatencyChart component with real data integration ([c591d6a](https://github.com/pkallos/wan-monitor/commit/c591d6ae690bf79bb0bda05114a29db158afaf72))
* create LatencyChart with real data and fix backend TypeError ([3480663](https://github.com/pkallos/wan-monitor/commit/3480663a3aabc5818ceb9cbab9aa6084f07f2e95))
* date range selector defaults to 1hr and persists in localStorage ([81f0563](https://github.com/pkallos/wan-monitor/commit/81f056300df6d5b855a10d35349d17a79fb4ec16))
* date range selector defaults to 1hr and persists in localStorage ([296f66a](https://github.com/pkallos/wan-monitor/commit/296f66a4d518a2207b59fdf817a92510e39e5b18))
* implement Fastify backend with Effect-TS and QuestDB ([e94d6e0](https://github.com/pkallos/wan-monitor/commit/e94d6e03181924f351f6e56f93347284fd04bd09))
* implement Fastify backend with Effect-TS and QuestDB (PHI-1) ([3b0e1c2](https://github.com/pkallos/wan-monitor/commit/3b0e1c2644dbfccfab9e97e08e780e32907bfffc))
* implement periodic network monitoring with Effect Schedule (PHI-5) ([2f8a7a8](https://github.com/pkallos/wan-monitor/commit/2f8a7a8665f4dda074071a4beeea5c38c27621c9))
* implement ping packet trains for better packet loss measurement ([acdd521](https://github.com/pkallos/wan-monitor/commit/acdd521c2354d0900b7d96c30dc7d9c8e7c0fa3d))
* implement ping packet trains for better packet loss measurement ([ed98e56](https://github.com/pkallos/wan-monitor/commit/ed98e56c631b381f9c2c3fbe28d8fd7cc0451f7b))
* implement PingService with connectivity detection (PHI-2) ([30cb366](https://github.com/pkallos/wan-monitor/commit/30cb366e71b37f8a72633fb3e66ff2b264bf9336))
* implement PingService with connectivity detection (PHI-2) ([108a8a5](https://github.com/pkallos/wan-monitor/commit/108a8a500b5ce3a6422130ce8cb8f9e0e9e88a5a))
* implement speed test service with comprehensive metrics (PHI-37) ([1c9d189](https://github.com/pkallos/wan-monitor/commit/1c9d189cf812ec898bef4f28d123fe6a2b49c286))
* implement speed test service with hourly scheduling (PHI-37) ([e5d1ffe](https://github.com/pkallos/wan-monitor/commit/e5d1ffe2d1f8b2415ff62f8a0ccc68ca60c46e49))
* improve backend logging with pino-pretty ([546e9b1](https://github.com/pkallos/wan-monitor/commit/546e9b19e7e610539b6936d2fe55ea462cd0e353))
* improve backend logging with pino-pretty ([f3541d1](https://github.com/pkallos/wan-monitor/commit/f3541d17b52526d03eda4bc5e5edbc3a858c576f))
* improve environment variable handling for dev and Docker ([a648fc5](https://github.com/pkallos/wan-monitor/commit/a648fc55b03b9012cbbf5cc101f170d2badd02c6))
* improve environment variable handling for dev and Docker ([19ae8d7](https://github.com/pkallos/wan-monitor/commit/19ae8d70dae0dd9638326d5d6debc4cb53e31051))
* improve QuestDB client usage with HTTP transport and batching ([1ef3008](https://github.com/pkallos/wan-monitor/commit/1ef3008ad9b5c76464b7336686277f5ccde4d1bc))
* improve QuestDB client usage with HTTP transport and batching ([fbd2333](https://github.com/pkallos/wan-monitor/commit/fbd233306605360ed0ddc903d43a5839e550afa9))
* initialize WAN Monitor project ([a979789](https://github.com/pkallos/wan-monitor/commit/a97978987da4722580ef3514ffd56508b70ccff2))
* integrate NetworkMonitor into server startup ([b5fcf42](https://github.com/pkallos/wan-monitor/commit/b5fcf42d16aa2bb05e349522ab0d85fe8313ee47))
* make data gaps visible in Network Quality charts with timeline filling ([bc3aa3b](https://github.com/pkallos/wan-monitor/commit/bc3aa3b1faaf213810875ce8dbfbed892d5eb4b1))
* make data gaps visible in Network Quality charts with timeline filling ([31a8a31](https://github.com/pkallos/wan-monitor/commit/31a8a310a0d140571e1a2d24b1e986de3173af5e))
* make date selector responsive - wrap to own line on narrow screens ([a353b04](https://github.com/pkallos/wan-monitor/commit/a353b049797e39d076e6b0f4c072565584c25613))
* make date selector responsive - wrap to own line on narrow screens ([aa0afaa](https://github.com/pkallos/wan-monitor/commit/aa0afaa90a40d96ebd4beba780ef0eef02fb24f8))
* redesign dashboard with ISP display and linked chart cursors ([b236b3d](https://github.com/pkallos/wan-monitor/commit/b236b3dcb64f5c9f5eed582f64d5c5e86184422c))
* redesign dashboard with ISP display and linked chart cursors ([f5a9759](https://github.com/pkallos/wan-monitor/commit/f5a9759fa1048cc33ed2338fadeaa5132a0333c8))
* refactor server routes into modular structure with Fastify plugins (PHI-26) ([7b1a763](https://github.com/pkallos/wan-monitor/commit/7b1a763763d0a6d97811f35139be211bf313a969))
* refactor server routes into modular structure with Fastify plugins (PHI-26) ([a554db1](https://github.com/pkallos/wan-monitor/commit/a554db1798d79acd66fa53c0c41711c0b0ee58fd))
* refactor to pnpm workspaces with Turborepo (PHI-33) ([bed8709](https://github.com/pkallos/wan-monitor/commit/bed8709a595034e265bb1f8be7ff1c4f79e7bbc4))
* refactor to pnpm workspaces with Turborepo (PHI-33) ([792320b](https://github.com/pkallos/wan-monitor/commit/792320b728d4253454d3039dc862325043bda687))
* restore speedtest functionality removed in PR [#29](https://github.com/pkallos/wan-monitor/issues/29) ([c424485](https://github.com/pkallos/wan-monitor/commit/c42448580fffc8c289afc80d8bc1e7fd46bb127e))
* restore speedtest functionality removed in PR 29 ([fb227ce](https://github.com/pkallos/wan-monitor/commit/fb227cef64223a1b2719a339debdc9205a3f26ea))
* use PostgreSQL wire protocol for queries with parameterized statements ([1b4a370](https://github.com/pkallos/wan-monitor/commit/1b4a370f53591f22965b497b43a10aa6e44ad3c5))


### Bug Fixes

* Docker native module compilation and container logging ([8b8e828](https://github.com/pkallos/wan-monitor/commit/8b8e828dd009e98fecd64bdc9a724df9aef62b2a))
* Docker native module compilation and container logging ([9fbffe7](https://github.com/pkallos/wan-monitor/commit/9fbffe7c67d8d9473f60e49cc7b8b8ca766a38ea))
* make Release Please manual-only trigger ([ea786be](https://github.com/pkallos/wan-monitor/commit/ea786becbe0e367aaf992db36a2a87aa35fc80e9))
* make Release Please manual-only trigger ([944dca2](https://github.com/pkallos/wan-monitor/commit/944dca23909867ecbcafabda8482317c6c7075d0))
* ping failures write NULL latency instead of -1 to avoid skewing aggregations ([df3c8ba](https://github.com/pkallos/wan-monitor/commit/df3c8ba42eefd7a833596d0b07183f4eb1141ad7))
* ping failures write NULL latency instead of -1 to avoid skewing aggregations ([971400b](https://github.com/pkallos/wan-monitor/commit/971400b479e9f180f684dff1cce4084460979ce0))
* prevent pg library from converting timestamps to local timezone ([05e6dee](https://github.com/pkallos/wan-monitor/commit/05e6dee9325fbbf0892630dd84c8793d046f6302))
* replace relative imports with @/ path aliases and enforce with Biome (PHI-30) ([07d0f18](https://github.com/pkallos/wan-monitor/commit/07d0f183a96c5f20f833880fe1ab1b1b6c3c155d))
* replace relative imports with @/ path aliases and enforce with Biome (PHI-30) ([bf92e96](https://github.com/pkallos/wan-monitor/commit/bf92e96c374f6dead08f5c0facf910545915aa88))
* retrieve jitter data from database query ([970907e](https://github.com/pkallos/wan-monitor/commit/970907ebe427294f336d25a50d7ad91bbb09405b))
* show full time range in chart even with sparse data ([aef2402](https://github.com/pkallos/wan-monitor/commit/aef2402cd91987f766a10c534b1c61e74a25d74e))
* simplify Release Please to single workflow with v4 API ([1400c5f](https://github.com/pkallos/wan-monitor/commit/1400c5fd33169d21ddd4f41f0d753105fd1adc73))
* simplify Release Please to single workflow with v4 API ([2c5b420](https://github.com/pkallos/wan-monitor/commit/2c5b420402a8085e218df3e286522c12d1462546))
* use last(timestamp) in SAMPLE BY query to return actual data timestamps ([c54ad82](https://github.com/pkallos/wan-monitor/commit/c54ad825db3b6df833a0b6f71bf82290a8a6dcd7))
* Y-axis formatting on Latency chart showing incorrect values ([6326214](https://github.com/pkallos/wan-monitor/commit/63262147fc5b4b0d26f9167f4d9c5ea7b0c46619))
* Y-axis formatting on Latency chart showing incorrect values ([134ed10](https://github.com/pkallos/wan-monitor/commit/134ed10885df8f6b65b61eee89443b6f9d99b29d))
