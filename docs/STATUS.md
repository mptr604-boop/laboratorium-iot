# STATUS: czytaj to najpierw

Aktualizuj ten plik w tym samym commicie, w którym zmienia się kod lub decyzja. Cel: poniżej 150 linii.

**Ostatnia aktualizacja:** 2026-10-24 · **Wersja:** 1.0.0 · **Testy:** `npm test` (39 przechodzą)

## 1. Czym jest projekt

System akwizycji danych z aparatów laboratoryjnych (LIMS / IoT) w natywnym Node.js i SQLite WAL: zero zależności runtime.
Dane wpadają przez TCP (ESP32) lub HTTP, są parsowane, walidowane kontraktem i zapisywane. Szczegóły: [README.md](../README.md).

## 2. Mapa plików

| Ścieżka | Zadanie |
|---|---|
| `src/utils/parser.js` | Surowy wydruk aparatu → `{ density, temperature, fuelStatus }`; nie rzuca wyjątków na śmieciach |
| `src/contracts/measurement.contract.js` | Kontrakt dokumentu pomiaru (walidator + `describeContract()`); `npm run contract` generuje tabelę |
| `src/models/db.operations.js` | Dostęp do SQLite (WAL); `saveMeasurement` sprawdza kontrakt przed zapisem |
| `src/tcp_server.js` | Odbiór ramek z ESP32; kontrakt → `STATUS:INVALID_DATA` |
| `src/http_server.js`, `src/routes/app.router.js` | Serwer HTTP i router (bez Expressa) |
| `src/controllers/` | `lab.controller.js` (akcje POST), `view.controller.js` (widoki SSR) |
| `src/middlewares/auth.middleware.js` | RBAC na podstawie sesji |
| `src/utils/csrf.js` | Blokada żądań cross-site (Sec-Fetch-Site, Origin) dla każdego POST, wpięta w router |
| `src/utils/session.js` | Sesje: losowy id w ciasteczku, skrót SHA-256 w tabeli `sessions`, TTL 8 h |
| `src/utils/logger.js` | Logi JSON, ID korelacji żądania, maskowanie sekretów |
| `src/utils/anomalyMonitor.js`, `detective.js`, `errorHandler.js` | Alerty okna czasowego, obserwacja stanu, ochrona procesu |
| `src/utils/cache.js`, `uploader.js` | Cache z TTL, parser multipart |
| `src/mock_esp32.js` | Symulator urządzenia |
| `scripts/perf-test.js` | Test wydajności (`npm run perf`) |
| `src/test/` | `app`, `contract`, `logger` |
| `src/db.js` | **Martwy plik**, nic go nie używa |
| `environment/` | Dockerfile, compose, `deploy.sh` (deploy, rollback, restore, journal) |
| `scripts/` | `backup.js`, `restore.js`, `lib/journal.js` |

## 3. Uruchomienie

`npm start` (HTTP) · `npm run tcp` · `npm run mock:esp32` · `npm run seed` · `npm test` · `npm run perf` · `npm run contract`
Izolowana baza do testów: zmienna `DB_DIR`.

## 4. Stan funkcji

| Funkcja | Stan |
|---|---|
| Parser, kontrakt, zapis w WAL, TCP + HTTP | ✅ |
| Logi strukturalne (JSON, ID korelacji, maskowanie) | ✅ |
| Test wydajności | ✅ (lokalny loopback) |
| RBAC, sesje w ciasteczku, SSR, PWA, Docker, rollback | ✅ |
| Backup/restore bazy, dziennik wdrożeń (`journal.jsonl`) | ✅ testy z atrapą dockera |
| Asystent AI | ⏳ osobny projekt: `laboratorium-ai` |

## 5. Znane problemy i słabości (stan faktyczny)

- Hasła: SHA-256 **bez soli** (w produkcji bcrypt/argon2).
- Sesje: własna implementacja (nie biblioteka). Brak limitu prób logowania.
- Nie ma już REST-owego uwierzytelniania nagłówkiem `Authorization: Bearer`; API działa na sesji z ciasteczka (klient nieprzeglądarkowy musi najpierw się zalogować i przenosić ciasteczko).
- TCP zapisuje pomiary z zakodowanym `user_id = 1`.
- Brak limitu rozmiaru bufora TCP i brak rate limitingu.
- Domyślne hasła użytkowników seedowych.
- Zakresy kontraktu (gęstość 300–1200 kg/m³, temperatura −50–100 °C) to **założenia**, nie dane z aparatu.
- Przepływ `deploy.sh` nie był sprawdzony na prawdziwym Dockerze; backup wymaga Node 24 na hoście.
- Wyniki `perf` pochodzą z lokalnego loopbacku, nie z produkcji.
- Teksty UI, komunikaty flash i dane seedowe są po polsku (celowo).
- Zmiana nazw pól/statusów nie migruje starych baz (projekt demonstracyjny).

## 6. Decyzje

- `node:http` zamiast Expressa: mniej zależności i mniejsze ryzyko supply chain, kosztem większej ilości pracy.
- Kontrakt w `saveMeasurement`, więc żadna ścieżka wejścia go nie omija.
- Sesja w ciasteczku zamiast JWT: jedna aplikacja z SSR, możliwość unieważnienia po stronie serwera, brak własnej kryptografii do utrzymania. JWT był wcześniejszym eksperymentem (historia git).
- CSRF: `SameSite=Strict` plus sprawdzenie `Sec-Fetch-Site`/`Origin` w routerze, bez tokenów w HTML. Powód: widoki są cache'owane per użytkownik (10 s), więc token w formularzu rozjeżdżałby się z sesją. Żądania bez tych nagłówków (curl, skrypty) przechodzą, bo CSRF wymaga przeglądarki ofiary.
- Statusy: `NORMAL`, `OUT_OF_SPEC`, `CORRUPTED_TRANSMISSION`, `DEVICE_FAULT`, `PARSER_ERROR`; pole `fuel_status`.
- Identyfikatory po angielsku, komentarze po polsku.
- Historia commitów jest uporządkowana warstwowo (porządki przy publikacji, nie chronologia).

## 7. Dziennik zmian

| Data | Zmiana |
|---|---|
| 2026-10 | Logi strukturalne, test wydajności, kontrakt danych |
| 2026-10 | Refaktor nazw: angielskie identyfikatory i statusy, komentarze po polsku |
| 2026-10-24 | `docs/STATUS.md` i `AGENTS.md` |
| 2026-10-24 | JWT zastąpione sesją w ciasteczku (`session.js`, `POST /logout`), 8 nowych testów |
| 2026-10-24 | Ochrona CSRF (`csrf.js`), test blokady fałszywego POST |
| 2026-10-25 | Naprawa `deploy.sh` (stary nic nie robił), osobne dane per środowisko, backup/restore bazy, dziennik wdrożeń |
