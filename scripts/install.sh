#!/data/data/com.termux/files/usr/bin/bash
# ──────────────────────────────────────────────────────
# Termux CPanel — Automated Installer
# Run inside Termux:  bash scripts/install.sh
# ──────────────────────────────────────────────────────
set -e

echo ""
echo "══════════════════════════════════════════════"
echo "  🚀  Termux CPanel Installer"
echo "══════════════════════════════════════════════"
echo ""

# 1) Update packages
echo "▶ [1/5] Updating packages..."
pkg update -y && pkg upgrade -y

# 2) Install dependencies
echo ""
echo "▶ [2/5] Installing Node.js, Git, Cloudflared..."
pkg install -y nodejs git cloudflared

# Optional but recommended
pkg install -y termux-api || true

# 3) Prevent Android from killing the process
echo ""
echo "▶ [3/5] Acquiring wake lock..."
termux-wake-lock || echo "  ⚠️  termux-wake-lock unavailable (install termux-api for full support)"

# 4) Install npm modules
echo ""
echo "▶ [4/5] Installing npm packages..."
cd "$(dirname "$0")/.."
npm install

# 5) Create runtime folders
echo ""
echo "▶ [5/5] Preparing directories..."
mkdir -p www logs
touch www/.gitkeep

echo ""
echo "══════════════════════════════════════════════"
echo "  ✅  Installation complete!"
echo "══════════════════════════════════════════════"
echo ""
echo "  Next steps:"
echo "    1) Start the server:      bash scripts/start.sh"
echo "    2) Open the panel at:     http://localhost:3000/panel"
echo "    3) Start a tunnel from:   Cloudflare Tunnel tab"
echo ""
echo "  Versions installed:"
echo "    Node.js : $(node --version)"
echo "    npm     : $(npm --version)"
echo "    git     : $(git --version | head -c40)"
echo "    cloudflared : $(cloudflared --version 2>/dev/null | head -c40 || echo 'not found')"
echo ""
