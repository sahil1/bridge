#!/usr/bin/env sh
# Same as `npm start`: ./start.sh [dev|phone]
cd "$(dirname "$0")" && exec node scripts/start.js "$@"
