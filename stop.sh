#!/usr/bin/env sh
# Same as `npm run stop`: ./stop.sh [phone]
cd "$(dirname "$0")" && exec node scripts/stop.js "$@"
