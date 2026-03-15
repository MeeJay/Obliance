#!/bin/bash
# build-mac.sh — Build Obliance.app for macOS (arm64 + amd64)
# Run from the desktop-app/ directory: ./build-mac.sh
#
# To release a new version:
#   1. Edit desktop-app/VERSION  (e.g. 1.2.0)
#   2. Run this script — the version is injected everywhere automatically.
set -e

BINARY_NAME="obliance"
APPNAME="Obliance"
BUNDLE="$APPNAME.app"
PNG="logo.png"

# ── Read version (single source of truth) ────────────────────────────────────
if [ ! -f VERSION ]; then
  echo "ERROR: VERSION file not found in $(pwd)."
  exit 1
fi
VERSION=$(cat VERSION | tr -d '[:space:]')
if [ -z "$VERSION" ]; then
  echo "ERROR: VERSION file is empty."
  exit 1
fi
echo "  Version: $VERSION"

# ── Step 1: Ensure logo.png exists for go:embed ──────────────────────────────
echo "=== Step 1: Checking logo.png for go:embed ==="
if [ ! -f "$PNG" ]; then
  echo "  logo.png not found — generating from logo.webp via sips..."
  if ! sips -s format png "../client/public/logo.webp" --out "$PNG" 2>/dev/null; then
    echo "ERROR: Could not convert logo.webp to PNG."
    exit 1
  fi
fi
echo "  OK: $PNG ($(wc -c < "$PNG" | tr -d ' ') bytes)"

# ── Step 2: Detect native arch + cross-compile target ────────────────────────
NATIVE_GOARCH="$(go env GOARCH 2>/dev/null || uname -m | sed 's/x86_64/amd64/')"
case "$NATIVE_GOARCH" in
  arm64) CROSS_GOARCH="amd64"; CROSS_CLANG="x86_64" ;;
  amd64) CROSS_GOARCH="arm64"; CROSS_CLANG="arm64"  ;;
  *) echo "ERROR: Unknown arch $NATIVE_GOARCH"; exit 1 ;;
esac

# ── Step 3: Build native binary ───────────────────────────────────────────────
echo "=== Step 2: Building native binary (darwin/$NATIVE_GOARCH) ==="
CGO_ENABLED=1 GOOS=darwin GOARCH="$NATIVE_GOARCH" \
  go build -ldflags "-X main.appVersion=$VERSION" -o "${BINARY_NAME}-${NATIVE_GOARCH}" .
echo "  Built: ${BINARY_NAME}-${NATIVE_GOARCH} ($(du -sh "${BINARY_NAME}-${NATIVE_GOARCH}" | cut -f1))"

# ── Step 4: Cross-compile (non-fatal) ────────────────────────────────────────
echo "=== Step 3: Cross-compiling (darwin/$CROSS_GOARCH) ==="
CROSS_OK=0
if CGO_ENABLED=1 GOOS=darwin GOARCH="$CROSS_GOARCH" \
   CGO_CFLAGS="-arch $CROSS_CLANG" CGO_LDFLAGS="-arch $CROSS_CLANG" \
   go build -ldflags "-X main.appVersion=$VERSION" -o "${BINARY_NAME}-${CROSS_GOARCH}" . 2>&1; then
  echo "  Built: ${BINARY_NAME}-${CROSS_GOARCH} ($(du -sh "${BINARY_NAME}-${CROSS_GOARCH}" | cut -f1))"
  CROSS_OK=1
else
  echo "  WARNING: Cross-compilation to darwin/$CROSS_GOARCH failed — skipping."
fi

# ── Step 5: Generate AppIcon.icns (arch-independent, done once) ──────────────
echo "=== Step 4: Generating AppIcon.icns ==="
ICONSET="AppIcon.iconset"
rm -rf "$ICONSET"
mkdir "$ICONSET"
for size in 16 32 128 256 512; do
  double=$((size * 2))
  sips -z $size   $size   "$PNG" --out "$ICONSET/icon_${size}x${size}.png"    2>/dev/null
  sips -z $double $double "$PNG" --out "$ICONSET/icon_${size}x${size}@2x.png" 2>/dev/null
done
iconutil -c icns "$ICONSET" -o "AppIcon.icns"
rm -rf "$ICONSET"
echo "  Generated: AppIcon.icns"

mkdir -p dist

# ── Helper: create .app bundle, zip, and DMG for a given arch ────────────────
package_arch() {
  local ARCH="$1"
  local BINARY_PATH="${BINARY_NAME}-${ARCH}"

  if [ ! -f "$BINARY_PATH" ]; then
    echo "  SKIP: No binary found for darwin/$ARCH"
    return 0
  fi

  echo ""
  echo "=== Packaging darwin/$ARCH ==="

  # ── .app bundle ─────────────────────────────────────────────────────────────
  rm -rf "$BUNDLE"
  mkdir -p "$BUNDLE/Contents/MacOS"
  mkdir -p "$BUNDLE/Contents/Resources"
  cp "$BINARY_PATH" "$BUNDLE/Contents/MacOS/$BINARY_NAME"
  cp "AppIcon.icns" "$BUNDLE/Contents/Resources/AppIcon.icns"

  cat > "$BUNDLE/Contents/Info.plist" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleIdentifier</key>
  <string>me.binaryhearts.obliance</string>
  <key>CFBundleName</key>
  <string>Obliance</string>
  <key>CFBundleDisplayName</key>
  <string>Obliance</string>
  <key>CFBundleExecutable</key>
  <string>obliance</string>
  <key>CFBundleIconFile</key>
  <string>AppIcon</string>
  <key>CFBundleVersion</key>
  <string>$VERSION</string>
  <key>CFBundleShortVersionString</key>
  <string>$VERSION</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>NSHighResolutionCapable</key>
  <true/>
  <key>NSHumanReadableCopyright</key>
  <string>Copyright © 2025 BinaryHearts</string>
  <key>LSMinimumSystemVersion</key>
  <string>10.13</string>
  <!-- Allows the webview to load http:// URLs during first-run setup -->
  <key>NSAppTransportSecurity</key>
  <dict>
    <key>NSAllowsArbitraryLoads</key>
    <true/>
  </dict>
</dict>
</plist>
EOF

  # ── Zip ──────────────────────────────────────────────────────────────────────
  local ZIP_OUT="dist/${APPNAME}-${ARCH}.zip"
  rm -f "$ZIP_OUT"
  ditto -c -k --sequesterRsrc --keepParent "$BUNDLE" "$ZIP_OUT"
  echo "  Zipped: $ZIP_OUT ($(du -sh "$ZIP_OUT" | cut -f1))"

  # ── DMG ──────────────────────────────────────────────────────────────────────
  local DMG_OUT="dist/${APPNAME}-${ARCH}.dmg"
  local DMG_STAGING="__dmg_staging_${ARCH}__"
  local DMG_TMP="__tmp_${ARCH}_rw.dmg"
  local BACKGROUND="build/dmg-background.png"

  local WIN_W=540  WIN_H=380  WIN_LEFT=200  WIN_TOP=120
  local WIN_RIGHT=$((WIN_LEFT + WIN_W))
  local WIN_BOTTOM=$((WIN_TOP + WIN_H))
  local ICON_SIZE=128  APP_X=160  APP_Y=190  APPS_X=380  APPS_Y=190

  rm -rf "$DMG_STAGING"
  mkdir "$DMG_STAGING"
  cp -R "$BUNDLE" "$DMG_STAGING/"
  ln -s /Applications "$DMG_STAGING/Applications"

  rm -f "$DMG_OUT" "$DMG_TMP"

  # Detach any lingering volume from a previous failed build (e.g. after an
  # AppleScript timeout that prevented hdiutil detach from running).
  hdiutil detach "/Volumes/$APPNAME" -force 2>/dev/null || true

  hdiutil create \
    -srcfolder "$DMG_STAGING" \
    -volname "$APPNAME" \
    -format UDRW \
    -o "$DMG_TMP"

  local MOUNT_POINT
  # hdiutil output is tab-delimited; use -F'\t' so volume names containing
  # spaces (e.g. "Obliance 1" when a previous mount was not ejected) are
  # captured correctly as a single field instead of being split by awk.
  MOUNT_POINT=$(hdiutil attach -readwrite -noverify -noautoopen "$DMG_TMP" \
    | awk -F'\t' '/\/Volumes\//{print $NF}')

  if [ -z "$MOUNT_POINT" ]; then
    echo "  ERROR: Could not mount DMG for $ARCH"
    rm -f "$DMG_TMP"
    rm -rf "$DMG_STAGING" "$BUNDLE"
    return 1
  fi
  echo "  Mounted at: $MOUNT_POINT"

  local BG_APPLESCRIPT="-- no background"
  if [ -f "$BACKGROUND" ]; then
    mkdir -p "$MOUNT_POINT/.background"
    cp "$BACKGROUND" "$MOUNT_POINT/.background/background.png"
    BG_APPLESCRIPT="set background picture of viewOptions to file \".background:background.png\""
  fi

  # Style the DMG window via Finder (requires a GUI/desktop session).
  # In headless SSH builds the Finder is unavailable; we suppress the error and
  # continue — the DMG will work fine as an installer without custom styling.
  osascript 2>/dev/null <<APPLESCRIPT || echo "  NOTE: Finder styling skipped (headless/SSH session — DMG will still work)."
tell application "Finder"
  tell disk "$APPNAME"
    open
    set current view of container window to icon view
    set toolbar visible of container window to false
    set statusbar visible of container window to false
    set bounds of container window to {$WIN_LEFT, $WIN_TOP, $WIN_RIGHT, $WIN_BOTTOM}
    set viewOptions to the icon view options of container window
    set arrangement of viewOptions to not arranged
    set icon size of viewOptions to $ICON_SIZE
    $BG_APPLESCRIPT
    set position of item "$BUNDLE" to {$APP_X, $APP_Y}
    set position of item "Applications" to {$APPS_X, $APPS_Y}
    close
    open
    update without registering applications
    delay 2
    close
  end tell
end tell
APPLESCRIPT

  sync
  hdiutil detach "$MOUNT_POINT" -quiet
  sleep 1

  hdiutil convert "$DMG_TMP" \
    -format UDZO \
    -imagekey zlib-level=9 \
    -o "$DMG_OUT"

  rm -f "$DMG_TMP"
  rm -rf "$DMG_STAGING"
  rm -rf "$BUNDLE"

  echo "  DMG:   $DMG_OUT ($(du -sh "$DMG_OUT" | cut -f1))"
}

# ── Step 6: Package native arch (fatal on failure) ───────────────────────────
package_arch "$NATIVE_GOARCH"

# ── Step 7: Package cross arch (non-fatal) ───────────────────────────────────
if [ "$CROSS_OK" -eq 1 ]; then
  set +e
  package_arch "$CROSS_GOARCH"
  CROSS_PKG_RC=$?
  set -e
  if [ $CROSS_PKG_RC -ne 0 ]; then
    echo "  WARNING: Packaging for $CROSS_GOARCH failed (skipped)."
  fi
fi

# ── Cleanup ───────────────────────────────────────────────────────────────────
rm -f "AppIcon.icns"
rm -f "${BINARY_NAME}-${NATIVE_GOARCH}" 2>/dev/null || true
[ "$CROSS_OK" -eq 1 ] && rm -f "${BINARY_NAME}-${CROSS_GOARCH}" 2>/dev/null || true

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo "=== Done! ==="
ls -lh dist/Obliance-*.{zip,dmg} 2>/dev/null || true
echo ""
echo "NOTE: If macOS blocks the app (Gatekeeper) because it is unsigned:"
echo "  Right-click → Open  (first time only)"
echo "  or: xattr -dr com.apple.quarantine Obliance.app"
