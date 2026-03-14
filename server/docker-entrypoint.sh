#!/bin/sh
set -e

# If /custom/.ssh exists, symlink /root/.ssh to it so SSH transparently uses
# the persisted keys and known_hosts across container recreates.
if [ -d "/custom/.ssh" ]; then
  rm -rf /root/.ssh
  ln -sf /custom/.ssh /root/.ssh
fi

exec "$@"
