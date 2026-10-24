// src/db.js (Część 1)
// Importujemy wbudowany, ultra-wydajny moduł bazy danych SQLite z Node.js (od wersji 22.5.0+)
import { DatabaseSync } from 'node:sqlite';
// Importujemy natywny moduł path do bezpiecznego zarządzania ścieżkami systemowymi
import path from 'node:path';
// Importujemy natywny moduł fs do weryfikacji i tworzenia katalogów na dysku
import fs from 'node:fs';

// --- INTELIGENTNA LOKALIZACJA BAZY DANYCH (DEV VS STAGING/PROD DOCKER) ---

// Odczytujemy ze zmiennych środowiskowych, czy aplikacja działa wewnątrz kontenera Docker
const CZY_DOCKER = process.env.IS_DOCKER === 'true';

// Ustalamy ścieżkę: w Dockerze ląduje w /app/storage, na Devie wewnątrz src/storage w projekcie
const KATALOG_BAZY = CZY_DOCKER 
  ? '/app/storage' 
  : path.join(process.cwd(), 'src', 'storage');

// Sprawdzamy przy użyciu modułu fs, czy wskazany katalog fizycznie istnieje na dysku
if (!fs.existsSync(KATALOG_BAZY)) {
  // Jeśli katalogu nie ma, tworzymy go automatycznie wraz z podfolderami
  fs.mkdirSync(KATALOG_BAZY, { recursive: true });
}

// Składamy ostateczną, bezpieczną ścieżkę systemową do pliku naszej bazy danych SQLite
const SCIEZKA_PLIKU_BAZY = path.join(KATALOG_BAZY, 'laboratorium.sqlite');

// Uruchamiamy i synchronizujemy silnik SQLite, wskazując mu wyliczoną ścieżkę
const db = new DatabaseSync(SCIEZKA_PLIKU_BAZY);
console.log(`[DATABASE] Połączono z bazą danych pod ścieżką: ${SCIEZKA_PLIKU_BAZY}`);

// --- STRUKTURA TYPÓW JSDOC (ZAMIAST TYPESCRIPTU) ---

/**
 * @typedef {Object} EmbeddedComment
 * @property {string} user - Nazwa lub imię pracownika laboratorium dodającego notatkę
 * @property {string} text - Treść notatki lub komentarza dotyczącego badania
 * @property {string} date - Data dodania wpisu w formacie tekstowym ISO
 */

/**
 * @typedef {Object} DevicePayloadNoSQL
 * @property {string} raw_text - Surowy zrzut tekstowy przechwycony z portu starej drukarki aparatu
 * @property {number} [parsed_density] - Wyciągnięta przez parser gęstość paliwa w kg/m3 (brak dla czujnika klimatu)
 * @property {number|string} [parsed_humidity] - Wilgotność względna w % (tylko czujnik klimatu)
 * @property {number} parsed_temperature - Wyciągnięta przez parser temperatura pomiaru w stopniach C
 * @property {string} status_paliwa - Ocena zgodności paliwa z normą laboratoryjną
 * @property {EmbeddedComment[]} comments - Tablica komentarzy osadzona bezpośrednio w dokumencie (NoSQL Embedding)
 */

// --- INICJALIZACJA SCHEMATU BAZY (SQL + NOSQL + CACHE) ---

// Wykonujemy polecenie SQL tworzące tabelę użytkowników systemu (Klasyczny Relacyjny SQL)
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT, -- Unikalny, automatycznie inkrementowany klucz główny użytkownika
    username TEXT UNIQUE NOT NULL,        -- Unikalna nazwa użytkownika wykorzystywana jako login
    password_hash TEXT NOT NULL,          -- Zahaszowane hasło autoryzacyjne pracownika
    role TEXT NOT NULL                    -- Rola w systemie kontroli dostępu: 'admin', 'engineer', 'worker'
  );
`);

// Wykonujemy polecenie SQL tworzące tabelę aparatów laboratoryjnych (Klasyczny Relacyjny SQL)
db.exec(`
  CREATE TABLE IF NOT EXISTS devices (
    id INTEGER PRIMARY KEY AUTOINCREMENT, -- Unikalny identyfikator systemowy urządzenia
    token TEXT UNIQUE NOT NULL,           -- Bezpieczny token sieciowy, którym ESP32 legitymuje się przez port TCP
    name TEXT NOT NULL,                   -- Czytelna dla ludzi nazwa aparatu (np. "Gęstościomierz D100")
    type TEXT NOT NULL                    -- Typ transmisji sprzętowej: 'legacy_print', 'modern_json' albo 'climate_sensor' (ESP32 + DHT11)
  );
`);

// Wykonujemy polecenie SQL tworzące główną tabelę badań (Hybryda: Relacja SQL + Dokument NoSQL JSON)
db.exec(`
  CREATE TABLE IF NOT EXISTS measurements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,     -- Unikalny numer referencyjny badania laboratoryjnego
    device_id INTEGER NOT NULL,               -- Klucz obcy łączący badanie relacją SQL z konkretnym aparatem ESP32
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP, -- Automatyczny znacznik czasu zapisu rekordu w bazie danych
    nosql_data TEXT NOT NULL,                 -- Kolumna typu TEXT przechowująca kompletny dokument NoSQL w formacie JSON
    FOREIGN KEY(device_id) REFERENCES devices(id) -- Wymuszenie integralności danych na poziomie silnika SQL
  );
`);

// Wykonujemy polecenie SQL tworzące naszą własną strukturę Cache (Zastępuje nam zewnętrznego Redisa)
db.exec(`
  CREATE TABLE IF NOT EXISTS app_cache (
    cache_key TEXT PRIMARY KEY,               -- Unikalny klucz podręczny (np. adres URL strony lub zapytanie API)
    cache_value TEXT NOT NULL,                -- Scałowany, gotowy HTML strony lub spakowany ciąg JSON z danymi
    expires_at INTEGER NOT NULL               -- Znacznik czasu UNIX (w milisekundach), po którym cache wygasa
  );
`);

// Wykonujemy polecenie SQL tworzące rejestr diagnostyczny dla naszego autorskiego Detektywa Observable
db.exec(`
  CREATE TABLE IF NOT EXISTS detektyw_bugs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,     -- Unikalny numer identyfikacyjny anomalii logicznej
    environment TEXT NOT NULL,                -- Środowisko uruchomieniowe błędu: 'DEV' lub 'STAGING'
    error_context TEXT NOT NULL,              -- Szczegółowy zrzut pamięci RAM z wykrytym cichym 'undefined'
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP -- Dokładny moment zrzucenia raportu przez agenta
  );
`);
// src/db.js (Część 2)

// --- EKSPORT OPERACJI INTERFEJSU DANYCH (CRUD & CACHE) ---
export const dbOperations = {
  
  // Metoda rejestracji nowego użytkownika systemu w bazie relacyjnej
  createUser: (username, passwordHash, role) => {
    // Tworzymy bezpieczne, parametryzowane zapytanie, które chroni system przed SQL Injection
    const stmt = db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)');
    // Wykonujemy zapytanie, podstawiając bezpiecznie zmienne w miejsce znaków zapytania
    return stmt.run(username, passwordHash, role);
  },

  // Metoda wyciągania profilu użytkownika po jego unikalnym loginie
  getUserByUsername: (username) => {
    // Przygotowujemy instrukcję selekcji danych z tabeli użytkowników
    const stmt = db.prepare('SELECT * FROM users WHERE username = ?');
    // Pobieramy dokładnie jeden pasujący wiersz z bazy danych
    return stmt.get(username);
  },

  // Metoda dodawania nowego autoryzowanego aparatu pomiarowego IoT do sieci
  createDevice: (token, name, type) => {
    // Przygotowujemy polecenie SQL wprowadzające aparat do rejestru
    const stmt = db.prepare('INSERT INTO devices (token, name, type) VALUES (?, ?, ?)');
    // Realizujemy zapis urządzenia w bazie SQLite
    return stmt.run(token, name, type);
  },

  // Metoda weryfikacji urządzenia na porcie TCP za pomocą przesłanego tokenu sieciowego
  getDeviceByToken: (token) => {
    // Przygotowujemy instrukcję przeszukiwania bazy aparatów po unikalnym tokenie
    const stmt = db.prepare('SELECT * FROM devices WHERE token = ?');
    // Zwracamy obiekt aparatu lub undefined, jeśli token jest podrobiony bądź nie istnieje
    return stmt.get(token);
  },

  // Metoda zapisu badania jako dokumentu JSON połączonego relacją SQL z tabelą aparatów
  saveMeasurement: (deviceId, nosqlDataObject) => {
    // Konwertujemy żywy obiekt JavaScript na tekstowy ciąg znaków JSON (Serializacja NoSQL)
    const jsonText = JSON.stringify(nosqlDataObject);
    // Przygotowujemy polecenie zapisu nowego badania w bazie
    const stmt = db.prepare('INSERT INTO measurements (device_id, nosql_data) VALUES (?, ?)');
    // Uruchamiamy zapis w pliku SQLite
    return stmt.run(deviceId, jsonText);
  },

  // Zaawansowana agregacja danych realizująca odpowiednik mongo-wego .populate() / \$lookup (NoSQL References)
  getMeasurementsPopulated: () => {
    // Składamy zapytanie SQL łączące tabelę badań z relacyjną tabelą aparatów za pomocą złączenia JOIN
    const stmt = db.prepare(`
      SELECT m.id, m.created_at, m.nosql_data, d.name as device_name, d.type as device_type
      FROM measurements m
      JOIN devices d ON m.device_id = d.id
      ORDER BY m.created_at DESC
    `);
    // Pobieramy kompletną lista wszystkich wierszy spełniających to kryterium
    const rows = stmt.all();
    // Mapujemy surowe wiersze z bazy, aby przekształcić kolumnę tekstową JSON w prawdziwy obiekt JS
    return rows.map(row => ({
      id: row.id,                                   // Przypisujemy systemowe ID badania
      device_name: row.device_name,                 // Wstrzykujemy pobraną relacją nazwę aparatu (Populate / References)
      device_type: row.device_type,                 // Wstrzykujemy pobrany relacją typ urządzenia
      created_at: row.created_at,                   // Przypisujemy datę rejestracji pomiaru
      data: JSON.parse(row.nosql_data)              // Deserializujemy tekst bazy z powrotem w dynamiczny obiekt NoSQL
    }));
  },

  // Zapis gotowych struktur danych lub kodu HTML do podręcznej pamięci cache (Cache Set a'la Redis)
  setCache: (key, valueObject, ttlInMs) => {
    // Wyliczamy dokładny moment wygaśnięcia wpisu cache (obecny czas UNIX + czas życia TTL)
    const expiresAt = Date.now() + ttlInMs;
    // Zamieniamy obiekt JavaScript na ciąg tekstowy
    const valueText = JSON.stringify(valueObject);
    // Przygotowujemy instrukcję zapisu typu UPSERT (zaktualizuj jeśli istnieje, wstaw jeśli nie ma)
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO app_cache (cache_key, cache_value, expires_at)
      VALUES (?, ?, ?)
    `);
    // Realizujemy zapis w pamięci cache bazy danych
    return stmt.run(key, valueText, expiresAt);
  },

  // Odczyt danych z podręcznej pamięci podręcznej (Cache Get) wraz z automatyczną weryfikacją wygasania czasu życia TTL
  getCache: (key) => {
    // Przygotowujemy polecenie wyszukania cache po unikalnym kluczu identyfikacyjnym
    const stmt = db.prepare('SELECT * FROM app_cache WHERE cache_key = ?');
    // Pobieramy wiersz z bazy danych SQLite
    const row = stmt.get(key);
    // Jeśli nastąpiło chybienie cache (brak wpisu w bazie), zwracamy null (Cache Miss)
    if (!row) return null;
    // Sprawdzamy czy obecny czas UNIX przekroczył zapisaną w bazie barierę ważności expires_at
    if (Date.now() > row.expires_at) {
      // Jeśli cache jest przestarzały, przygotowujemy polecenie natychmiastowego czyszczenia rekordu
      const deleteStmt = db.prepare('DELETE FROM app_cache WHERE cache_key = ?');
      // Kasujemy przedawniony rekord z bazy danych
      deleteStmt.run(key);
      // Zwracamy null informując system o wygaśnięciu danych (Cache Expired)
      return null;
    }
    // Jeśli cache jest świeży i poprawny, parsujemy tekst bazy i zwracamy obiekt (Cache Hit)
    return JSON.parse(row.cache_value);
  },

  // Metoda archiwizacji cichych anomalii logicznych wysłanych przez agenta Detektywa Observable
  logDetektywBug: (env, context) => {
    // Przygotowujemy instrukcję wprowadzenia błędu diagnostycznego do tabeli
    const stmt = db.prepare('INSERT INTO detektyw_bugs (environment, error_context) VALUES (?, ?)');
    // Wykonujemy natychmiastowy zapis raportu deweloperskiego
    return stmt.run(env, context);
  }
};

