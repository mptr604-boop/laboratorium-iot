// src/utils/detective.js
// Zaawansowany silnik Observable (get/set) zintegrowany z Monitorem Anomalii Okien Czasowych

import { dbOperations } from '../models/db.operations.js';
import { anomalyMonitor } from './anomalyMonitor.js'; // INTEGRACJA Z MONITOREM ANOMALII

const ENV = process.env.NODE_ENV || 'development';

// Rejestr aktywnych procesów obserwujących w pamięci RAM
let aktywneSubskrypcje = [];

export const detectiveObservable = {
  /**
   * REJESTRACJA (SUBSCRIBE): Zapina nowy proces obserwujący i zwraca klucz do jego odpięcia
   */
  subscribe: (nazwaProcesu, funkcjaZwrotna) => {
    const subskrypcjaId = `sub_${Math.random().toString(36).substr(2, 9)}`;
    
    aktywneSubskrypcje.push({
      id: subskrypcjaId,
      proces: nazwaProcesu,
      callback: funkcjaZwrotna,
      ZapietyAt: new Date().toISOString()
    });
    
    console.log(`[DETEKTYW-OBSERVABLE] Zapięto subskrypcję: [${nazwaProcesu}] (ID: ${subskrypcjaId})`);
    return subskrypcjaId;
  },

  /**
   * WYREJESTROWANIE (UNSUBSCRIBE): Usuwa wskazany proces z pamięci RAM (Ochrona przed Memory Leak)
   */
  unsubscribe: (subskrypcjaId) => {
    const indeks = aktywneSubskrypcje.findIndex(sub => sub.id === subskrypcjaId);
    if (indeks !== -1) {
      const nazwaUsunietego = aktywneSubskrypcje[indeks].proces;
      aktywneSubskrypcje.splice(indeks, 1);
      console.log(`[DETEKTYW-OBSERVABLE] Wyrejestrowano proces: [${nazwaUsunietego}] (ID: ${subskrypcjaId})`);
    }
  },

  /**
   * DIAGNOSTYKA: Lista aktywnych subskrybentów
   */
  pobierzAktywneProcesy: () => {
    return aktywneSubskrypcje.map(sub => ({ id: sub.id, proces: sub.proces, zapiety: sub.ZapietyAt }));
  },

  /**
   * POWIADOMIENIE (NOTIFY): Rozsyła alarm do wszystkich subskrybentów RAM
   */
  notify: (komunikat) => {
    aktywneSubskrypcje.forEach(sub => {
      try {
        sub.callback(komunikat);
      } catch (err) {
        console.error(`[DETEKTYW-ALERT-FAIL] Proces [${sub.proces}] wywalił się: ${err.message}`);
      }
    });
  }
};

// --- FUNKCJA INTEGRALNOŚCI DANYCH (SZUKANIE UNDEFINED / BŁĘDÓW LOGICZNYCH) ---
function scanStructureForUndefined(obj) {
  if (obj === undefined) return true;
  if (obj === null || typeof obj !== 'object') return false;
  for (const k in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, k)) {
      if (obj[k] === undefined || scanStructureForUndefined(obj[k])) return true;
    }
  }
  return false;
}

// --- AUTOMATYCZNE PRZECHWYTYWANIE AKCESORÓW GET / SET (SILNIK OBSERVABLE) ---
export const dbDetective = {};

Object.keys(dbOperations).forEach(kluczMetody => {
  let oryginalnaMetoda = dbOperations[kluczMetody];

  Object.defineProperty(dbDetective, kluczMetody, {
    get() {
      return function (...args) {
        if (scanStructureForUndefined(args)) {
          const logBledu = `Próba wywołania metody bazy [${kluczMetody}] z wartością undefined. Dane: ${JSON.stringify(args)}`;
          
          // 1. Rozsyłamy powiadomienie do subskrybentów RAM
          detectiveObservable.notify(logBledu);

          // 2. !!! MONITROWANIE OKIEN CZASOWYCH APP !!!
          anomalyMonitor.registerIncident('ERR_CODE_APPLICATION_CRASH', `Metoda [${kluczMetody}]`);
        }
        return oryginalnaMetoda.apply(this, args);
      };
    },
    set(nowaWartosc) {
      if (scanStructureForUndefined(nowaWartosc)) {
        detectiveObservable.notify(`Zablokowano próbę wstrzyknięcia wartości undefined do właściwości [${kluczMetody}]`);
        anomalyMonitor.registerIncident('ERR_CODE_APPLICATION_CRASH', `Wstrzyknięcie we właściwość [${kluczMetody}]`);
        return;
      }
      oryginalnaMetoda = nowaWartosc;
    },
    enumerable: true,
    configurable: true
  });
});

// --- DOŁĄCZENIE FABRYCZNYCH OBSERWATORÓW SYSTEMOWYCH ---
detectiveObservable.subscribe('Konsolowy_Agent_Diagnostyczny', (alarm) => {
  console.error(`[DETEKTYW-ALARM] Środowisko: ${ENV.toUpperCase()} | Kontekst: ${alarm}`);
});

detectiveObservable.subscribe('Archiwizator_Błędów_SQLite', (alarm) => {
  try {
    dbOperations.logDetectiveBug(ENV.toUpperCase(), alarm);
  } catch (err) {
    console.error(`[DETEKTYW-CRITICAL] Awaria zapisu logu w bazie: ${err.message}`);
  }
});
