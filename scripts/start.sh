#!/data/data/com.termux/files/usr/bin/bash
# ──────────────────────────────────────────────────────
# Termux CPanel — Background Launcher
# Starts server.js + quick cloudflared tunnel in background
# ──────────────────────────────────────────────────────
set -e

cd "$(dirname "$0")/.."

# Prevent Android from suspending the process
termux-wake-lock 2>/dev/null || true

mkdir -p logs

# Kill previous instances if any
pkill -f "node server.js" 2>/dev/null || true
pkill -f "cloudflared tunnel --url" 2>/dev/null || true

echo ""
echo "══════════════════════════════════════════════"
echo "  🚀  Starting Termux CPanel"
echo "══════════════════════════════════════════════"

# 1) Node.js server
echo "▶ Launching Node.js server on port 3000..."
nohup node server.js > logs/server.log 2>&1 &
SERVER_PID=$!
echo "  PID: $SERVER_PID"

# Wait for server to be ready
sleep 3

if ! kill -0 "$SERVER_PID" 2>/dev/null; then
  echo "  ❌ Server failed to start. Check logs/server.log"
  exit 1
fi

echo "  ✅ Server started: http://localhost:3000/panel"

# 2) Optional quick tunnel
read -rp "▶ Start a Quick Cloudflare Tunnel now? [y/N]: " START_TUNNEL
if [[ "${START_TUNNEL,,}" == "y" ]]; then
  if command -v cloudflared >/dev/null 2>&1; then
    nohup cloudflared tunnel --url http://localhost:3000 --no-autoupdate > logs/tunnel-quick.log 2>&1 &
    TUNNEL_PID=$!
    echo "  PID: $TUNNEL_PID"
    echo "  ⏳ Waiting for public URL..."
    for i in $(seq 1 30); do
      sleep 1
      URL=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' logs/tunnel-quick.log | head -n1 || true)
      if [[ -n "$URL" ]]; then
        echo ""
        echo "  ✅ Public URL: $URL"
        echo ""
        break
      fi
    done
    if [[ -z "$URL" ]]; then
      echo "  ⚠️  URL not detected yet. Check logs/tunnel-quick.log"
    fi
  else
    echo "  ⚠️  cloudflared not installed. Skipping tunnel."
  fi
fi

echo ""
echo "══════════════════════════════════════════════"
echo "  📋 Summary"
echo "══════════════════════════════════════════════"
echo "  Panel URL   : http://localhost:3000/panel"
echo "  Server log  : logs/server.log"
echo "  Tunnel log  : logs/tunnel-quick.log"
echo ""
echo "  🛑 Stop all: pkill -f 'node server.js'; pkill -f cloudflared"
echo ""
