#!/bin/sh
set -e

REPO="https://raw.githubusercontent.com/MeeJay/obliance/main"
INSTALL_DIR="${OBLIANCE_DIR:-./obliance}"

echo ""
echo "  ╔═══════════════════════════════╗"
echo "  ║     Obliance — Installer      ║"
echo "  ╚═══════════════════════════════╝"
echo ""

# Check docker
if ! command -v docker > /dev/null 2>&1; then
  echo "✗ Docker is not installed. Please install Docker first."
  echo "  https://docs.docker.com/get-docker/"
  exit 1
fi

if ! docker compose version > /dev/null 2>&1; then
  echo "✗ Docker Compose v2 is required. Please update Docker."
  exit 1
fi

# Create install directory
mkdir -p "$INSTALL_DIR"
cd "$INSTALL_DIR"

echo "→ Installing in: $(pwd)"
echo ""

# Download compose + env example
echo "→ Downloading docker-compose.yml..."
curl -fsSL "$REPO/docker-compose.yml" -o docker-compose.yml

if [ ! -f ".env" ]; then
  echo "→ Downloading .env.example..."
  curl -fsSL "$REPO/.env.example" -o .env.example

  # Generate random secrets
  SESSION_SECRET=$(cat /dev/urandom | tr -dc 'A-Za-z0-9' | head -c 48 2>/dev/null || \
                   openssl rand -hex 24 2>/dev/null || \
                   echo "please-change-this-secret-$(date +%s)")
  DB_PASSWORD=$(cat /dev/urandom | tr -dc 'A-Za-z0-9' | head -c 24 2>/dev/null || \
                openssl rand -hex 12 2>/dev/null || \
                echo "please-change-this-password")

  # Generate .env with random secrets pre-filled
  sed \
    -e "s|SESSION_SECRET=change-this-to-a-random-secret|SESSION_SECRET=$SESSION_SECRET|" \
    -e "s|DB_PASSWORD=changeme|DB_PASSWORD=$DB_PASSWORD|" \
    .env.example > .env

  echo ""
  echo "  ✓ .env created with generated secrets."
  echo "  → Review and adjust settings if needed: $(pwd)/.env"
  echo ""
else
  echo "  → .env already exists, skipping."
fi

# Create custom directory structure
mkdir -p custom/scripts custom/.ssh

echo "→ Starting Obliance..."
echo ""
docker compose pull
docker compose up -d

echo ""
echo "  ╔══════════════════════════════════════╗"
echo "  ║        Obliance is running!          ║"
echo "  ╚══════════════════════════════════════╝"
echo ""
echo "  → Open: http://localhost:3000"
echo "  → Default login: admin / admin123"
echo "  → Change the default password after first login!"
echo ""
echo "  Useful commands:"
echo "    docker compose -f $(pwd)/docker-compose.yml logs -f"
echo "    docker compose -f $(pwd)/docker-compose.yml down"
echo "    docker compose -f $(pwd)/docker-compose.yml pull && docker compose up -d  # update"
echo ""
