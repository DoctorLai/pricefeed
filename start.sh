#!/bin/bash
pm2 delete feed 2>/dev/null || true
pm2 start feed.js --name feed --max-memory-restart 200M
