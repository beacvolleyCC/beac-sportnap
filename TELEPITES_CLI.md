# Alternatív telepítés – Wrangler CLI

Cloudflare 2026-os dokumentációja szerint Wranglerhez támogatott Node.js verzió szükséges, és a helyi Wrangler hivatalosan Windows 11-en támogatott. Emiatt ehhez a projekthez a GitHub + Cloudflare Dashboard telepítést javasoljuk.

Ha mégis CLI-t használsz:

```bash
npm install
npm test
npx wrangler login --device
npx wrangler deploy
npx wrangler secret put ADMIN_PIN
```

Az első `wrangler deploy` automatikusan provisionálhatja a konfigurációban ID nélkül szereplő `ARCHIVE` KV namespace-t.

Lokális fejlesztés:

```bash
npm run dev
```
