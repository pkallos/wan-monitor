#!/bin/bash
# Entrypoint script for WAN Monitor
# Sets up QuestDB log configuration before starting services

# Create QuestDB conf directory if it doesn't exist
mkdir -p /var/lib/questdb/conf

# Always overwrite log.conf to ensure our log level settings take effect
# This is necessary because the volume might contain an old log.conf with defaults
cp /opt/questdb-log.conf /var/lib/questdb/conf/log.conf

# Start supervisord
exec /usr/bin/supervisord -c /etc/supervisor/conf.d/supervisord.conf
