// src/server.js
// Importujemy wbudowany, niskopoziomowy moduł HTTP z Node.js
import http from 'node:http';

// Odczytujemy wersję aplikacji ze zmiennej środowiskowej (wstrzykniemy ją przez Dockera/Git Tagi)
const APP_VERSION = process.env.APP_VERSION || 'v1.0.0-dev';
// Odczytujemy środowisko, na którym pracuje aplikacja ('staging' lub 'production')
const ENV = process.env.NODE_ENV || 'development';
// Definiujemy port, na którym serwer będzie nasłuchiwał
const PORT = process.env.PORT || 3000;

// Tworzymy instancję serwera HTTP
const server = http.createServer((req, res) => {
  // Ustawiamy nagłówek odpowiedzi informujący, że zwracamy czysty tekst w kodowaniu UTF-8
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  
  // Zwracamy prosty komunikat diagnostyczny pokazujący stan infrastruktury
  res.end(`[LABORATORIUM API] Serwer działa prawidłowo.\nŚrodowisko: ${ENV.toUpperCase()}\nWersja: ${APP_VERSION}\n`);
});

// Uruchamiamy nasłuchiwanie serwera na wskazanym porcie
server.listen(PORT, '0.0.0.0', () => {
  console.log(`[SERVER] Serwer testowy uruchomiony na porcie ${PORT} w trybie ${ENV} (Wersja: ${APP_VERSION})`);
});
