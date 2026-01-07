#!/bin/bash
set -e

# Database seeding script for E2E tests
# Seeds QuestDB with deterministic test data for ping and speedtest metrics

DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-9100}"
DB_URL="http://${DB_HOST}:${DB_PORT}"

echo "🌱 Seeding test database at ${DB_URL}..."

# Wait for QuestDB to be ready
max_retries=30
retry_count=0
until curl -sf "${DB_URL}/exec?query=SELECT%201" > /dev/null 2>&1; do
  retry_count=$((retry_count + 1))
  if [ $retry_count -ge $max_retries ]; then
    echo "❌ QuestDB not ready after ${max_retries} attempts"
    exit 1
  fi
  echo "⏳ Waiting for QuestDB to be ready (attempt ${retry_count}/${max_retries})..."
  sleep 2
done

echo "✅ QuestDB is ready"

# Create the network_metrics table
echo "📊 Creating network_metrics table..."
curl -G "${DB_URL}/exec" --data-urlencode "query=CREATE TABLE IF NOT EXISTS network_metrics (
  timestamp TIMESTAMP,
  source SYMBOL,
  host SYMBOL,
  latency DOUBLE,
  jitter DOUBLE,
  packet_loss DOUBLE,
  connectivity_status STRING,
  download_bandwidth LONG,
  upload_bandwidth LONG,
  server_location STRING,
  isp STRING,
  external_ip STRING,
  internal_ip STRING
) TIMESTAMP(timestamp) PARTITION BY DAY WAL;" > /dev/null

echo "✅ Table created"

# Generate deterministic test data
# Current time minus various offsets to create historical data
# Using ISO 8601 format for timestamps

echo "📝 Inserting deterministic ping metrics..."

# Insert ping metrics for the last 24 hours (every 15 minutes = 96 data points)
# We'll use SQL INSERT for deterministic timestamps
# Use current date instead of hardcoded 2025 date
current_date=$(date -u +%Y-%m-%d)
base_timestamp="${current_date}T00:00:00.000000Z"

# Create a series of ping metrics with varying latency, jitter, and packet loss
for hour in {0..23}; do
  for quarter in 0 15 30 45; do
    # Calculate deterministic but realistic values
    minute_offset=$((hour * 60 + quarter))

    # Latency: base 20ms with some variation (10-50ms)
    latency=$(echo "20 + ($minute_offset % 30)" | bc)

    # Jitter: 0-5ms
    jitter=$(echo "scale=2; ($minute_offset % 50) / 10" | bc)

    # Packet loss: mostly 0, occasional spikes
    packet_loss=0
    if [ $((minute_offset % 20)) -eq 0 ]; then
      packet_loss=$(echo "scale=2; ($minute_offset % 5)" | bc)
    fi

    # Connectivity: online most of the time, offline occasionally
    connectivity="online"
    if [ $((minute_offset % 50)) -eq 0 ]; then
      connectivity="offline"
    fi

    # Format timestamp with current date
    printf -v padded_hour "%02d" $hour
    printf -v padded_minute "%02d" $quarter
    timestamp="${current_date}T${padded_hour}:${padded_minute}:00.000000Z"

    # Insert via REST API
    curl -G "${DB_URL}/exec" --data-urlencode "query=INSERT INTO network_metrics (
      timestamp, source, host, latency, jitter, packet_loss, connectivity_status,
      download_bandwidth, upload_bandwidth, server_location, isp, external_ip, internal_ip
    ) VALUES (
      '${timestamp}', 'ping', '8.8.8.8', ${latency}, ${jitter}, ${packet_loss}, '${connectivity}',
      null, null, null, null, null, null
    );" > /dev/null 2>&1
  done
done

echo "✅ Inserted 96 ping metrics (24 hours, 15-minute intervals)"

# Insert speedtest metrics (every 4 hours = 6 data points)
echo "📝 Inserting deterministic speedtest metrics..."

for hour in 0 4 8 12 16 20; do
  # Deterministic but realistic speedtest values
  download=$((100 + (hour * 5)))  # 100-200 Mbps
  upload=$((10 + (hour * 2)))      # 10-50 Mbps

  printf -v padded_hour "%02d" $hour
  timestamp="${current_date}T${padded_hour}:00:00.000000Z"

  curl -G "${DB_URL}/exec" --data-urlencode "query=INSERT INTO network_metrics (
    timestamp, source, host, latency, jitter, packet_loss, connectivity_status,
    download_bandwidth, upload_bandwidth, server_location, isp, external_ip, internal_ip
  ) VALUES (
    '${timestamp}', 'speedtest', 'speedtest.net', null, null, null, 'online',
    ${download}000000, ${upload}000000, 'San Francisco, CA', 'TestISP', '1.2.3.4', '192.168.1.100'
  );" > /dev/null 2>&1
done

echo "✅ Inserted 6 speedtest metrics (24 hours, 4-hour intervals)"

# Verify data was inserted
echo "🔍 Verifying inserted data..."
ping_count=$(curl -G "${DB_URL}/exec" --data-urlencode "query=SELECT COUNT(*) FROM network_metrics WHERE source = 'ping';" 2>/dev/null | grep -o '"count":[0-9]*' | cut -d':' -f2 || echo "0")
speedtest_count=$(curl -G "${DB_URL}/exec" --data-urlencode "query=SELECT COUNT(*) FROM network_metrics WHERE source = 'speedtest';" 2>/dev/null | grep -o '"count":[0-9]*' | cut -d':' -f2 || echo "0")

echo "📊 Data verification:"
echo "   - Ping metrics: ${ping_count}"
echo "   - Speedtest metrics: ${speedtest_count}"

if [ "$ping_count" -ge 90 ] && [ "$speedtest_count" -ge 5 ]; then
  echo "✅ Database seeding completed successfully!"
else
  echo "⚠️  Warning: Expected ~96 ping and ~6 speedtest metrics, got ${ping_count} and ${speedtest_count}"
  echo "   Continuing anyway..."
fi
