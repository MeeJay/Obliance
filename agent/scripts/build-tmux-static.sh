#!/usr/bin/env bash
# Build statically-linked tmux for shipping next to the agent.
# Run on a Linux host with build-essential. The output lands at
#   agent/dist/tmux/<target>/tmux
# where <target> matches the agent's Go target triple (linux-amd64,
# linux-arm64, freebsd-amd64, darwin-amd64, darwin-arm64).
#
# Why ship a static tmux: agents installed in airgap environments
# can't reach a package mirror, so the auto-install in tmux_install.go
# fails. The bundled binary is the last-resort fallback consulted by
# tmuxBinPath() — it gets dropped next to the agent executable by
# installer/install.sh (Linux/macOS).
#
# Dependencies built statically: libevent + ncurses (both BSD/MIT
# licensed, redistribution OK). Total binary size ~3-6 MB depending
# on the target arch.
#
# Pinned versions — review CVE feed periodically and bump:
TMUX_VERSION="${TMUX_VERSION:-3.4}"
LIBEVENT_VERSION="${LIBEVENT_VERSION:-2.1.12-stable}"
NCURSES_VERSION="${NCURSES_VERSION:-6.4}"

set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "Usage: $0 <target>   where <target> in linux-amd64 | linux-arm64 | darwin-amd64 | darwin-arm64 | freebsd-amd64"
  exit 1
fi
TARGET="$1"
HOST_TRIPLE=""
case "$TARGET" in
  linux-amd64)   HOST_TRIPLE="x86_64-linux-gnu" ;;
  linux-arm64)   HOST_TRIPLE="aarch64-linux-gnu" ;;
  freebsd-amd64) HOST_TRIPLE="x86_64-unknown-freebsd" ;;
  darwin-amd64)  HOST_TRIPLE="x86_64-apple-darwin" ;;
  darwin-arm64)  HOST_TRIPLE="aarch64-apple-darwin" ;;
  *) echo "Unknown target: $TARGET"; exit 1 ;;
esac

WORK="$(pwd)/build-tmux-$TARGET"
PREFIX="$WORK/staging"
OUTDIR="$(cd "$(dirname "$0")/../dist/tmux/$TARGET" && pwd 2>/dev/null || true)"
if [[ -z "$OUTDIR" ]]; then
  mkdir -p "$(dirname "$0")/../dist/tmux/$TARGET"
  OUTDIR="$(cd "$(dirname "$0")/../dist/tmux/$TARGET" && pwd)"
fi

# Idempotency — if a usable tmux binary already exists, skip the
# whole build (curl, configure, make ×3). The release bat calls us
# unconditionally as part of the agent build pipeline; without this
# we'd recompile ncurses/libevent/tmux on every release. Set the env
# var FORCE_TMUX_REBUILD=1 to bypass.
if [[ -z "${FORCE_TMUX_REBUILD:-}" && -x "$OUTDIR/tmux" ]]; then
  echo "✓ Existing $OUTDIR/tmux — skip rebuild (set FORCE_TMUX_REBUILD=1 to override)"
  "$OUTDIR/tmux" -V 2>/dev/null || true
  exit 0
fi

rm -rf "$WORK"; mkdir -p "$WORK"; cd "$WORK"

echo "→ Building tmux $TMUX_VERSION + libevent $LIBEVENT_VERSION + ncurses $NCURSES_VERSION for $TARGET"

# ── ncurses (static) ───────────────────────────────────────────────────
curl -fsSL "https://invisible-island.net/archives/ncurses/ncurses-$NCURSES_VERSION.tar.gz" | tar xz
cd "ncurses-$NCURSES_VERSION"
./configure --prefix="$PREFIX" --without-shared --without-debug --without-tests \
  --enable-pc-files --with-termlib --enable-widec --without-cxx --without-ada \
  --host="$HOST_TRIPLE" 2>&1 | tail -2
make -j"$(nproc 2>/dev/null || sysctl -n hw.ncpu)" install >/dev/null
cd ..

# ── libevent (static) ──────────────────────────────────────────────────
curl -fsSL "https://github.com/libevent/libevent/releases/download/release-$LIBEVENT_VERSION/libevent-$LIBEVENT_VERSION.tar.gz" | tar xz
cd "libevent-$LIBEVENT_VERSION"
./configure --prefix="$PREFIX" --disable-shared --enable-static --disable-openssl \
  --host="$HOST_TRIPLE" 2>&1 | tail -2
make -j"$(nproc 2>/dev/null || sysctl -n hw.ncpu)" install >/dev/null
cd ..

# ── tmux (links statically against the two above) ──────────────────────
curl -fsSL "https://github.com/tmux/tmux/releases/download/$TMUX_VERSION/tmux-$TMUX_VERSION.tar.gz" | tar xz
cd "tmux-$TMUX_VERSION"
LIBEVENT_CFLAGS="-I$PREFIX/include" \
LIBEVENT_LIBS="$PREFIX/lib/libevent.a" \
LIBNCURSES_CFLAGS="-I$PREFIX/include/ncursesw" \
LIBNCURSES_LIBS="$PREFIX/lib/libncursesw.a $PREFIX/lib/libtinfo.a" \
LDFLAGS="-static" \
./configure --enable-static --host="$HOST_TRIPLE" 2>&1 | tail -2
make -j"$(nproc 2>/dev/null || sysctl -n hw.ncpu)"
strip tmux 2>/dev/null || true
cp tmux "$OUTDIR/tmux"

echo "✓ Built $OUTDIR/tmux"
file "$OUTDIR/tmux" || true
ls -lh "$OUTDIR/tmux"
