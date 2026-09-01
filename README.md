# ArcusVerse

Live cricket (and multi-sport) player auction for local tournaments. Runs on your **LAN** — anyone on the same Wi‑Fi can join. No public IP.

## Quick start

```bash
npm install
npm run dev
```

Open the printed URL on this machine (projector / auctioneer) and share the LAN address with owners and spectators.

### Default access

| Role | How to sign in |
| --- | --- |
| Super Admin / Admin | PIN `0000` |
| Auctioneer | PIN `1111` |
| Owners | Auction code `ARCS` · usernames `raptors`, `titans`, `falcons`, `strikers` · password `owner` (or the team PIN on the team card) |

## What it covers

- **Tournaments** with sport, dates, venue, and an auction Yes/No flag (only Yes appears in Create Auction)
- **Players / Teams / Owners** CRUD, photo & logo upload, CSV bulk players, “Through Auction”, retentions (sold price doubled, deducted from purse)
- **Auctions** with purse, increment slabs, max squad, players per base-price cap, category minima, random or category-wise shuffle
- **Live hammer desk** (20s gavel, auto-sold on expiry, pause/resume freeze, unsold replayed at the end)
- **Owner bidding** with increment paddles, custom bid, greyed Place Bid when squad/base-price/max-bid locks hit
- **Post-auction summary** (highest bid, highest by base, counts, duration, average lot time)

Amounts are stored in **lakhs** (1 Cr = 100 L) and shown as ₹ Cr / ₹ L.
