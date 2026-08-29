# TELEPÍTÉS – ajánlott, GitHub + Cloudflare Dashboard

Ez az út nem igényel helyi Node/Wrangler telepítést.

## 1. GitHub

1. Hozz létre egy új repositoryt, pl. `beac-sportnap`.
2. Töltsd fel a ZIP KICSOMAGOLT tartalmát a repository gyökerébe.
3. A repository gyökerében közvetlenül látszódjon:
   - `package.json`
   - `wrangler.jsonc`
   - `src`
   - `public`
   - `google-backup`

## 2. Cloudflare

1. Nyisd meg a Cloudflare Dashboardot.
2. Menj: **Workers & Pages**.
3. **Create application**.
4. **Import a repository**.
5. Kösd össze a GitHub fiókodat és válaszd ki a repositoryt.
6. A Worker neve legyen: `beac-sportnap`
   - ennek egyeznie kell a `wrangler.jsonc` `name` mezőjével.
7. Deploy command: hagyd az alapértelmezett `npx wrangler deploy` értéken.
8. Deploy.

A `wrangler.jsonc` alapján Cloudflare létrehozza:
- a Worker alkalmazást,
- a SQLite-backed Durable Object namespace-t,
- az ARCHIVE KV namespace-t,
- és feltölti a `public` statikus fájlokat.

## 3. Admin PIN

Az első deploy után:

1. Cloudflare -> Worker -> **Settings**.
2. Keresd a **Variables and Secrets** részt.
3. Add secret:
   - Name: `ADMIN_PIN`
   - Value: a választott PIN, pl. ne 2468 legyen élesben.
4. Save / Deploy.

A PIN nem kerül bele a böngészőbe vagy a GitHub repositoryba.

## 4. Teszt

Nyisd meg:

- publikus: a Worker `workers.dev` URL-je
- admin: ugyanaz + `/admin.html`

Adminban:
1. PIN belépés.
2. Beállítások -> Esemény állapota -> LIVE.
3. Meccs -> INDÍTÁS.
4. Nyiss meg egy másik telefonon vagy privát ablakban a publikus oldalt.
5. Nyomj +1 pontot.
6. A publikus oldalon gyakorlatilag azonnal változnia kell.

## 5. Esemény végén

Admin -> Beállítások -> **SPORTNAP LEZÁRÁSA**.

Ekkor:
- eventStatus = ARCHIVED
- minden élő WebSocket lezárul
- a teljes publikus állapot bekerül a Workers KV-ba
- a QR-link tovább működik
- a publikus oldal betöltéskor KV-ból olvassa az eredményt
- nem nyit új realtime kapcsolatot
- nem kell aktív Durable Object az eredmények megtekintéséhez

## 6. Opcionális Google Sheet backup

A `google-backup/Code.gs` csak backup; a pontozás működéséhez nem kell.

1. Nyisd meg azt a Google Sheetet, amelybe backupot szeretnél.
2. Bővítmények -> Apps Script.
3. A Code.gs tartalmát cseréld a `google-backup/Code.gs` tartalmára.
4. Futtasd egyszer: `setupRealtimeBackup`.
5. Futtasd: `setRealtimeBackupToken`.
6. Adj meg egy legalább 16 karakteres véletlen tokent, és jegyezd meg.
7. Apps Script -> Deploy -> New deployment -> Web app.
8. Execute as: Me.
9. Who has access: Anyone.
10. Másold ki a Web App `/exec` URL-jét.

Cloudflare Worker -> Settings -> Variables and Secrets:
- Secret `BACKUP_URL` = az Apps Script `/exec` URL
- Secret `BACKUP_TOKEN` = pontosan ugyanaz a token

Ezután a rendszer lezárt fordulóknál, Final Four létrehozásakor és eseményállapot-váltáskor backup snapshotot küld a Sheetnek.

## 7. Ha módosítjuk a kódot

Csak töltsd fel/cseréld a változott fájlokat GitHubon és commitolj.
A Cloudflare Git-integráció automatikusan új buildet és deployt indít.
