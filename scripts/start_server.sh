#!/bin/bash
# start_server.sh - Safe launch script for ARM64 Visualizer Backend on Raspberry Pi 5

echo "Checking for previous backend instances on port 8000..."
# Free port 8000 if previously bound
fuser -k 8000/tcp 2>/dev/null || pkill -f "uvicorn app.main:app" 2>/dev/null
sleep 1

echo "Starting ARM64 Visualizer Backend on 0.0.0.0:8000..."
cd "$(dirname "$0")"
exec ./venv/bin/python3 -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --app-dir backend
