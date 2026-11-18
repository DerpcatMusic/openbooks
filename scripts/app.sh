#!/usr/bin/env bash
# OpenBooks as a desktop app: move this checkout up to the latest main, rebuild when that changed, (re)start the server on the new build,
# and open it in its own app window.
#   scripts/app.sh            launch (run it again any time: it updates first)
#   scripts/app.sh --install  add OpenBooks to the app menu / dock (Linux)
#   scripts/app.sh --stop     stop the server
# Books live in $OPENBOOKS_HOME (default ~/openbooks); logs and the server pid in ~/.local/state/openbooks.
set -euo pipefail
root=$(cd "$(dirname "$0")/.." && pwd)
export PATH="$HOME/.bun/bin:$PATH" # app launchers start without the shell's PATH
export OPENBOOKS_HOME=${OPENBOOKS_HOME:-$HOME/openbooks}
port=${OPENBOOKS_PORT:-8765}
url=http://127.0.0.1:$port
state=${XDG_STATE_HOME:-$HOME/.local/state}/openbooks
mkdir -p "$state" "$OPENBOOKS_HOME"
alive() { [[ -f $state/server.pid ]] && kill -0 "$(cat "$state/server.pid")" 2>/dev/null; }
stop() { if alive; then kill "$(cat "$state/server.pid")" && while alive; do sleep 0.1; done; fi; rm -f "$state/server.pid"; }

case ${1:-} in
  --stop) stop && exit ;;
  --install)
    apps=${XDG_DATA_HOME:-$HOME/.local/share}/applications
    mkdir -p "$apps"
    cat >"$apps/openbooks.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=OpenBooks
Comment=Bookkeeping, taxes and filings
Exec="$root/scripts/app.sh"
Icon=$root/apps/web/static/icon-512.png
Terminal=false
Categories=Office;Finance;
EOF
    echo "OpenBooks is in your app menu ($apps/openbooks.desktop)"
    exit ;;
esac

cd "$root"
# 1. latest main: fast-forward only, and only a tree without local edits; otherwise run what is checked out
if [[ -n $(git status --porcelain --untracked-files=no) ]]; then
  echo "openbooks: local edits here, not updating" >&2
elif ! git fetch -q origin main; then
  echo "openbooks: offline, not updating" >&2
elif ! git merge -q --ff-only origin/main 2>/dev/null; then
  echo "openbooks: this branch has its own commits, not updating" >&2
fi

# 2. rebuild when the commit changed since the last build
rev=$(git rev-parse HEAD)
if [[ $rev != "$(cat "$state/built" 2>/dev/null)" || ! -f apps/web/build/index.html ]]; then
  bun install --silent
  (cd apps/web && bunx vp build) >"$state/build.log" 2>&1 || { echo "openbooks: build failed, see $state/build.log" >&2; exit 1; }
  echo "$rev" >"$state/built"
fi

# 3. a server on the newest build (a restart locks the vault again: unlock it in the app)
if alive && [[ $(cat "$state/server.rev" 2>/dev/null) != "$rev" ]]; then stop; fi
if ! alive; then
  nohup bun apps/server/src/main.ts >>"$state/server.log" 2>&1 </dev/null &
  echo $! >"$state/server.pid"
  echo "$rev" >"$state/server.rev"
  for _ in $(seq 100); do curl -fs -o /dev/null "$url" && break; sleep 0.1; done
fi

# 4. an app window (any Chromium browser), else the default browser
for b in helium-browser chromium google-chrome-stable google-chrome brave microsoft-edge; do
  if command -v "$b" >/dev/null; then exec "$b" --app="$url" >/dev/null 2>&1; fi
done
if [[ $(uname) == Darwin ]]; then open "$url"; else xdg-open "$url"; fi
