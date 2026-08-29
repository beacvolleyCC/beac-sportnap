# QA – v0.5.0

## Automatikus
- `src/model.js` modelltesztek
- actionId deduplikáció
- döntetlen fordulólezárás tiltása
- fordulóváltás
- standings generálás
- public state nem szivárogtatja a recentActionIds listát
- JavaScript syntax check

## Kézi regresszió, deploy után
- Admin PIN hibás/helyes.
- UPCOMING alatt pontozás tiltott.
- LIVE után publikus WebSocket csatlakozik.
- Két böngészőn ugyanaz a pontszám jelenik meg.
- Gyors, többszörös + gomb nem veszít pontot.
- 1. telefon 1. pálya, 2. telefon 2. pálya párhuzamos pontozás.
- Rövid internetkimaradás: score action localStorage queue -> reconnect -> egyszeri szinkron.
- Döntetlennél fordulólezárás tiltott.
- Egy pont különbségnél lezárható.
- Tabella: 3/0 pont, pontkülönbség, szerzett pont, egymás elleni sorrend.
- Final Four csak 4 győztes után.
- ARCHIVED után publikus eredmények megmaradnak.
- ARCHIVED után publikus oldal nem nyit `/ws` kapcsolatot.
- QR és linkmegosztás.
- HU/EN: rendszerfeliratok és bajnokságnevek fordulnak, csapatnevek változatlanok.

- WebSocket upgrade az eredeti requesttel továbbítva.
- HTTP 4xx score hiba nem marad bent offline queue-ban.


## v0.5.3 timer regresszió
- READY -> INDÍTÁS + IDŐ NULLÁZÁSA
- RUNNING -> SZÜNET + STOP
- PAUSED -> FOLYTATÁS + STOP
- Pause megőrzi a hátralévő időt.
- Resume ugyanonnan folytatja.
- STOP döntetlennél blokkol.
- STOP nem döntetlennél lezárja a két aktuális mérkőzést és továbblép.
- A külön FORDULÓ LEZÁRÁSA gomb kikerült.
- A publikus oldalon pause alatt a timer megáll, és „Szüneteltetve / Paused” látható.


## v0.5.4 – pályánként külön vezérlés
Kötelező ellenőrzés:
- 1. pálya kiválasztva: INDÍTÁS csak az 1. pályát indítja.
- 2. pálya kiválasztva: INDÍTÁS csak a 2. pályát indítja.
- Az egyik pálya SZÜNET/FOLYTATÁS művelete nem módosítja a másik timerét.
- STOP pályánként csak az adott mérkőzést zárja.
- Lezárt meccsen a pontgombok tiltva vannak.
- A forduló csak akkor lép tovább, amikor mindkét aktuális mérkőzés lezárult.
- Mindkettő = GLOBÁLIS vezérlés:
  - INDÍTÁS/FOLYTATÁS minden még aktív, nem futó pályára hat;
  - SZÜNET minden éppen futó pályára hat;
  - STOP lezárja a nem döntetlen aktív meccseket;
  - döntetlen meccs nyitva marad, következő pont dönt.
- Publikus oldalon a két pálya saját ideje egymástól függetlenül látszik.
- v0.5.3 perzisztált állapot migrációja tesztelve.


## v0.5.5 – publikus státusz egyszerűsítés
- A cím alatti külön LIVE / event-status kapszula eltávolítva.
- A felső információs sáv az egyetlen publikus státuszjelzés.
- LIVE: „Élő eredmények”
- UPCOMING: „A bajnokság még nem kezdődött el.”
- ARCHIVED: „A bajnokság már lezárult.”
- CLOSED: „A sportnap lezárult.”
- Angol megfelelőik is frissítve.
- v0.5.4 pályánkénti timer/STOP logikához nem nyúltunk.


## v0.5.6 – Final Four reset javítás
- Ha T1–T4 közül bármelyik alapbajnokságot lenullázzuk, a már létrehozott Final Four automatikusan törlődik/letiltódik.
- Final csapatlista, meccsek, győztes és timerállapotok törlődnek.
- Ha éppen a FINAL volt kiválasztva, a rendszer T1-re áll vissza.
- Automatikus regressziós teszt hozzáadva.
