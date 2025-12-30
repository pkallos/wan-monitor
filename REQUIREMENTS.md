This application is a WAN monitoring dashboard that automatically runs some basic network tests and displays the results in a clean, responsive interface.

The goal would be to have it use free open source speed and network testing utilities like cloudflare/speedtest and have it run low-overhead tests periodically in order to detect, log and report on issues like:
 - WAN network outage: should be able to show when connectivity to the public internet has been lost
 - Latency (ping) over time: should be able to track and report on latency over time (with some reference hosts like 8.8.8.8 and 1.1.1.1 for example)
 - Spikes in packet loss and jitter: should be able to detect and report on sudden increases in packet loss or jitter

 The system should be able to report on the above metrics with a granularity of 60seconds or less.

 With less granularity, it should also be able to run speed tests on a schedule to track speed over time (let's say 1/hr)

 The application is meant to be self hosted, and it should be self contained in a Docker image that can be published, pulled and run easily and with minimal configuration or other external infrastructure dependencies.

 I'd like the application to be built with:
  - typescript with latest version, pnpm
  - frontend framework vite and react
  - chakra-ui
  - the best react compatible graphing library (research this)
  - cloudflare/speedtest library or the best possible equivalent that fits the requirements
  - a time series database that can be integrated very easily (maybe influxdb or whatever is best and most modern)


The username and password for the UI should be configurable with ENV variables in the docker container. when the docker container starts, the webserver should start on the configured port.

When the user loads the dashboard, they should be shown a simple dashboard that displays the historical information for
- network connectivity status (over time, green for up, red for down, yellow for degraded periods)
- packet loss (over time)
- latency (over time)
- speed (download and upload over time)
- jitter (over time)
- geographic location of the test server (if available)

The date range for the reporting should be configurable as well.

The application should be well unit and integration tested.
