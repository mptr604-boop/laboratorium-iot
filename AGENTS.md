# Instrukcje dla agentów

1. **Najpierw przeczytaj [docs/STATUS.md](./docs/STATUS.md)**: mapa plików, stan, znane słabości, decyzje. Nie skanuj całego repo, jeśli to wystarcza.
2. Po zmianie kodu lub decyzji zaktualizuj `docs/STATUS.md` w tym samym commicie.
3. Projekt ma **zero zależności runtime**. Nie dodawaj paczek bez wyraźnej zgody.
4. Identyfikatory po angielsku, komentarze po polsku.
5. Walidacja kontraktu zostaje w `saveMeasurement`. Nie omijaj jej nową ścieżką zapisu.
6. Przed commitem: `npm test`. Po zmianach w TCP lub zapisie dodatkowo `npm run perf`.
7. Nie zapisuj sekretów w kodzie. Logger maskuje klucze pasujące do `token|password|secret|authorization|cookie|jwt` (maskowanie, niezależnie od mechanizmu sesji).
8. Wdrożenia: skrypt zapisuje dziennik, a agent tylko doradza (naprawa w przód czy rollback). Agent **nie cofa bazy** ani nie uruchamia deployu bez człowieka. Przywrócenie bazy: `deploy.sh restore`, z backupu.
