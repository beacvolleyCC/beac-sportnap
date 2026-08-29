# BEAC Sportnap – Röplabda realtime béta v0.5.0

Ez a verzió már NEM Google Sheetből pontoz élőben.

## Architektúra

- Cloudflare Worker: API és admin-hitelesítés
- Durable Object + SQLite storage: az élő bajnokság egyetlen konzisztens állapota
- Hibernálható WebSocket: publikus és admin oldalak valós idejű frissítése
- Workers KV: az ARCHIVED állapot snapshotja; archiválás után a publikus oldal nem ébreszti fel a Durable Objectet
- Static Assets: public/admin HTML, CSS, JS
- Telefon localStorage: sikertelen pontmódosítások ideiglenes offline sora
- Google Sheet: opcionális backup, csak lezárt fordulóknál / eseményállapot-váltásnál

## URL-ek

- Publikus: `https://<worker-neved>.<subdomain>.workers.dev/`
- Admin: `https://<worker-neved>.<subdomain>.workers.dev/admin.html`

## Alap működés

1. Admin belép PIN-nel.
2. Beállítja a 4 bajnokság csapatneveit és játékidejét.
3. Esemény állapota -> LIVE.
4. Két telefon külön pályát választhat.
5. Pontgomb -> Worker -> Durable Object -> azonnali WebSocket broadcast.
6. Forduló lezárásakor döntetlen tiltott.
7. Sportnap végén -> SPORTNAP LEZÁRÁSA.
8. A publikus QR-oldal továbbra is mutatja az eredményt, de WebSocket nélkül KV snapshotból.
