#!/usr/bin/env bash
# Install/configure nginx so registration URLs work without :3000 (WhatsApp-clickable).
# Run on the EC2 host as a user with passwordless sudo.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

if ! command -v nginx >/dev/null 2>&1; then
  sudo dnf install -y nginx
fi

sudo cp -f "$ROOT/deploy/nginx-arcusverse.conf" /etc/nginx/conf.d/arcusverse.conf
sudo rm -f /etc/nginx/conf.d/default.conf 2>/dev/null || true

# Disable the stock RHEL default server block so conf.d owns :80.
if [ -f /etc/nginx/nginx.conf ] && grep -qE '^\s*listen\s+.*80' /etc/nginx/nginx.conf; then
  sudo cp -n /etc/nginx/nginx.conf /etc/nginx/nginx.conf.bak.arcus || true
  sudo python3 - <<'PY'
from pathlib import Path
import re
p = Path("/etc/nginx/nginx.conf")
text = p.read_text()
if "default server disabled — see conf.d/arcusverse.conf" in text:
    raise SystemExit(0)
pattern = re.compile(r"(    server \{.*?^\    \})", re.M | re.S)
m = pattern.search(text)
if not m:
    raise SystemExit(0)
block = m.group(1)
commented = "\n".join(("# " + line) if line.strip() else line for line in block.splitlines())
p.write_text(
    text[: m.start(1)]
    + "    # default server disabled — see conf.d/arcusverse.conf\n"
    + commented
    + text[m.end(1) :]
)
print("Commented default server in nginx.conf")
PY
fi

# Allow nginx → Node on SELinux-enforcing hosts
if command -v getenforce >/dev/null 2>&1 && [ "$(getenforce)" = "Enforcing" ]; then
  sudo setsebool -P httpd_can_network_connect 1
fi

sudo nginx -t
sudo systemctl enable nginx
sudo systemctl restart nginx
echo "nginx ready on :80 → 127.0.0.1:3000"
echo "Share links as http://<host>/register/<slug> (no :3000)."
echo "Ensure AWS security group allows inbound TCP 80."
