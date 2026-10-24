// src/utils/anomalyMonitor.js
// Silnik alertów anomalii z oknem czasowym (limit częstotliwości)

import { createLogger } from './logger.js';

const log = createLogger('anomaly');

// Rejestr w pamięci z czasami błędów do wykrywania anomalii w oknie przesuwnym
const incidentRegistry = {
  ERR_CODE_HARDWARE_FAILURE: [],
  ERR_CODE_APPLICATION_CRASH: [],
  // Stare aliasy
  KOD_AWARIA_SPRZETU: [],
  KOD_BLAD_PROGRAMISTYCZNY: []
};

// Konfiguracja okna: 3 incydenty w 30 sekund wywołują alert krytyczny
const MAX_INCIDENTS = 3;
const TIME_WINDOW_MS = 30000; 

// Aktywne alerty dla dashboardu i powiadomień PWA
let activeInfrastructureAlerts = [];

export const anomalyMonitor = {
  /**
   * Rejestruje incydent i ocenia częstotliwość w oknie przesuwnym.
   * @param {string} errType - 'ERR_CODE_HARDWARE_FAILURE' or 'ERR_CODE_APPLICATION_CRASH'
   * @param {string} contextMessage - opis kontekstu (np. metoda lub ID urządzenia)
   */
  registerIncident: (errType, contextMessage) => {
    const now = Date.now();
    
    // Normalizacja typu błędu
    const normalizedType = errType === 'KOD_AWARIA_SPRZETU' ? 'ERR_CODE_HARDWARE_FAILURE'
      : errType === 'KOD_BLAD_PROGRAMISTYCZNY' ? 'ERR_CODE_APPLICATION_CRASH'
      : errType;

    if (!incidentRegistry[normalizedType]) {
      incidentRegistry[normalizedType] = [];
    }

    incidentRegistry[normalizedType].push(now);

    // Filtr okna przesuwnego: usuwa wpisy starsze niż okno
    incidentRegistry[normalizedType] = incidentRegistry[normalizedType].filter(timestamp => now - timestamp <= TIME_WINDOW_MS);

    log.warn('incident.registered', {
      type: normalizedType,
      count_in_window: incidentRegistry[normalizedType].length,
      threshold: MAX_INCIDENTS,
    });

    // Alert po przekroczeniu progu
    if (incidentRegistry[normalizedType].length >= MAX_INCIDENTS) {
      const alertId = `alert_${Math.random().toString(36).substr(2, 9)}`;
      
      const newAlert = {
        id: alertId,
        typ: normalizedType,
        type: normalizedType,
        komunikat: `🚨 ALARM INFRASTRUKTURY! Błąd powtórzył się regularnie (${incidentRegistry[normalizedType].length} razy w ciągu 30s). Kontekst: ${contextMessage}`,
        message: `🚨 INFRASTRUCTURE ALERT! Failure repeated ${incidentRegistry[normalizedType].length} times within 30s window. Context: ${contextMessage}`,
        timestamp: new Date().toISOString(),
        wymagaAkcjiAdmina: normalizedType === 'ERR_CODE_APPLICATION_CRASH',
        wymagaAkcjiInzyniera: normalizedType === 'ERR_CODE_HARDWARE_FAILURE'
      };

      const isDuplicate = activeInfrastructureAlerts.some(a => a.type === normalizedType && a.message === newAlert.message);
      if (!isDuplicate) {
        activeInfrastructureAlerts.push(newAlert);
        log.error('alert.triggered', { alert_id: alertId, type: normalizedType, context: contextMessage });
      }
    }
  },

  /**
   * Zwraca listę aktywnych alertów
   */
  getActiveAlerts: () => {
    return activeInfrastructureAlerts;
  },

  /**
   * Potwierdza i zamyka alert o podanym ID
   */
  clearAlert: (alertId) => {
    activeInfrastructureAlerts = activeInfrastructureAlerts.filter(a => a.id !== alertId);
    log.info('alert.acknowledged', { alert_id: alertId });
  },

  // Aliasy zachowujące kompatybilność wsteczną
  rejestrujIncydent: (errType, msg) => anomalyMonitor.registerIncident(errType, msg),
  pobierzAktywneAlerty: () => anomalyMonitor.getActiveAlerts(),
  wyczyscAlert: (alertId) => anomalyMonitor.clearAlert(alertId)
};
