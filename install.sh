#!/usr/bin/env bash
set -euo pipefail

echo "🍳 Installing @sleeper/n8n-nodes-pocketbase for Raspberry Pi (n8n user)..."
echo ""

# Configuration
N8N_USER="${N8N_USER:-n8n}"
N8N_HOME="$(getent passwd "$N8N_USER" | cut -d: -f6)"
if [ -z "$N8N_HOME" ]; then
    echo "❌ Could not determine home directory for $N8N_USER."
    exit 1
fi
N8N_CUSTOM_DIR="${N8N_HOME}/.n8n/custom"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Check if npm is installed
if ! command -v npm &> /dev/null; then
    echo "❌ npm is not installed. Please install Node.js and npm first."
    exit 1
fi

# Check if running with appropriate permissions
if [ "$EUID" -ne 0 ]; then
    echo "⚠️  This script must be run as root (with sudo)"
    echo "   Run: sudo ./install.sh"
    exit 1
fi

# Check if n8n user exists
if ! id "$N8N_USER" &>/dev/null; then
    echo "❌ User $N8N_USER does not exist."
    echo "   Please ensure n8n is installed and running under the n8n user."
    exit 1
fi

if [ ! -f "${SCRIPT_DIR}/package.json" ]; then
    echo "❌ package.json not found in ${SCRIPT_DIR}"
    echo "   Please run this script from the repository directory."
    exit 1
fi

echo "Installing for user: $N8N_USER"
echo "Source directory: $SCRIPT_DIR"
echo "Custom nodes directory: $N8N_CUSTOM_DIR"
echo ""

# Ensure n8n owns the repo contents so installs work
echo "🔐 Setting permissions..."
chown -R "$N8N_USER:$N8N_USER" "$SCRIPT_DIR"

# Move into the repo directory
cd "$SCRIPT_DIR"

# Install dependencies as n8n user
echo "📦 Installing dependencies..."
sudo -u "$N8N_USER" -H npm install

# Build the node as n8n user
echo "🔨 Building the node..."
sudo -u "$N8N_USER" -H npm run build

# Create n8n custom nodes directory if it doesn't exist
echo "📁 Creating n8n custom nodes directory..."
mkdir -p "$N8N_CUSTOM_DIR"
chown -R "$N8N_USER:$N8N_USER" "${N8N_HOME}/.n8n"

if [ ! -f "${N8N_CUSTOM_DIR}/package.json" ]; then
    sudo -u "$N8N_USER" -H bash -c "cd \"$N8N_CUSTOM_DIR\" && npm init -y > /dev/null"
fi

# Install the node package into the custom extensions directory
echo "📦 Installing node into custom extensions directory..."
sudo -u "$N8N_USER" -H bash -c "cd \"$N8N_CUSTOM_DIR\" && npm install --production --no-save \"$SCRIPT_DIR\""

echo ""
echo "✅ Installation complete!"
echo ""
echo "📋 Next steps:"
echo "   1. Restart n8n service:"
echo "      sudo systemctl restart n8n"
echo ""
echo "   2. Check service status:"
echo "      sudo systemctl status n8n"
echo ""
echo "   3. View logs if needed:"
echo "      sudo journalctl -u n8n -f"
echo ""
echo "   4. Ensure N8N_CUSTOM_EXTENSIONS is set to:"
echo "      ${N8N_CUSTOM_DIR}"
echo "      Then restart n8n if you changed it."
echo ""
echo "   5. Open n8n in your browser and look for 'PocketBase' in the node panel"
echo ""
echo "📚 See README.md for usage examples and documentation"
echo ""
echo "🚀 Happy automating!"
