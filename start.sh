#!/bin/bash
set -x

## Delete the existing process if it exists.
pm2 delete feed 2>/dev/null || true

## You can pass additional arguments, for example --max-memory-restart 200M to set a memory limit for automatic restarts.
pm2 start feed.js --name feed $@

