# ArcusVerse EC2 deploy

## Public URLs (internet — no same Wi‑Fi required)

| Role | URL |
|------|-----|
| Admin / Owner / Auctioneer | http://3.16.112.125 |
| Spectator | http://3.16.112.125/live |
| Spectator + auction code | http://3.16.112.125/live/CODE |
| Registration | http://3.16.112.125/register/ACPL-6 |

Set `PUBLIC_URL` in the systemd unit or `deploy/production.env`. Registration links
are built from it, and WhatsApp only turns a URL into a tap-able link when there is
no `:port` in it — hence `PUBLIC_URL=http://3.16.112.125`.

## Serving port 80

`PUBLIC_URL` without a port means port **80** must answer, so `server.mjs` binds it
in addition to `PORT` (3000). No reverse proxy is involved; two things make it work:

- `AmbientCapabilities=CAP_NET_BIND_SERVICE` in `deploy/arcusverse.service`, since
  the service runs as `ec2-user` and ports below 1024 are privileged.
- Nothing else holding port 80. A leftover nginx/httpd keeps accepting connections
  even when it can no longer proxy, which makes every shared link hang while
  `:3000` still looks perfectly healthy.

If port 80 cannot be bound, the app logs the reason and advertises
`http://3.16.112.125:3000` instead, so copied links still work (just not
auto-linkified in chat apps).

To repair or verify port 80 on the host:

```bash
bash deploy/serve-public-port.sh http://3.16.112.125
```

It disables any reverse proxy on port 80, restarts `arcusverse`, and checks that
both ports return 200. Useful checks when it reports a failure:

```bash
sudo ss -ltnp "( sport = :80 )"      # who owns port 80
sudo journalctl -u arcusverse -n 50  # bind errors
```

## Deploy from Windows

```powershell
.\scripts\deploy-ec2.ps1
```

Requires OpenSSH (`ssh`, `scp`) and the PEM at:
`C:\Users\osinha\OneDrive - Qualys, Inc\Desktop\Keys\Arcusverse.pem`

## AWS security group

Inbound rules required on the instance security group:

- TCP **22** (SSH) from your IP
- TCP **80** from `0.0.0.0/0` — shared registration and spectator links
- TCP **3000** from `0.0.0.0/0` — direct access and the port-80 fallback

Without the port open, the app runs on the server (`curl localhost:80` works) but
browsers on the internet will time out.

## Service

```bash
sudo systemctl status arcusverse
sudo journalctl -u arcusverse -f
```
