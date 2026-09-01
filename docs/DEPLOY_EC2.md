# ArcusVerse EC2 deploy

## Public URLs (internet — no same Wi‑Fi required)

| Role | URL |
|------|-----|
| Admin / Owner / Auctioneer | http://3.16.112.125:3000 |
| Spectator | http://3.16.112.125:3000/live |
| Spectator + auction code | http://3.16.112.125:3000/live/CODE |

Set `PUBLIC_URL` in the systemd unit or `deploy/production.env`.

## Deploy from Windows

```powershell
.\scripts\deploy-ec2.ps1
```

Requires OpenSSH (`ssh`, `scp`) and the PEM at:
`C:\Users\osinha\OneDrive - Qualys, Inc\Desktop\Keys\Arcusverse.pem`

## AWS security group

Inbound rules required on the instance security group:

- TCP **22** (SSH) from your IP
- TCP **3000** from `0.0.0.0/0` (or a tighter CIDR)

Without port **3000** open, the app runs on the server (`curl localhost:3000` works) but browsers on the internet will time out.

## Service

```bash
sudo systemctl status arcusverse
sudo journalctl -u arcusverse -f
```
