#!/bin/sh
# Reload nginx every 6 hours so renewed Let's Encrypt certificates are picked up.
(
  while :; do
    sleep 21600
    nginx -s reload >/dev/null 2>&1 || true
  done
) >/dev/null 2>&1 &
exit 0
