// src/utils/anomalyMonitor.js
// Windowed Rate-Limiting Anomaly Alerting Engine

import { createLogger } from './logger.js';

const log = createLogger('anomaly');

// In-memory registry tracking error timestamps for sliding-window anomaly detection
const incidentRegistry = {
  ERR_CODE_HARDWARE_FAILURE: [],
  ERR_CODE_APPLICATION_CRASH: [],
  // Legacy aliases
  KOD_AWARIA_SPRZETU: [],
  KOD_BLAD_PROGRAMISTYCZNY: []
};

// Window configuration: 3 incidents within 30 seconds triggers critical alert
const MAX_INCIDENTS = 3;
const TIME_WINDOW_MS = 30000; 

// Active alerts for dashboard broadcast and PWA push
let activeInfrastructureAlerts = [];

export const anomalyMonitor = {
  /**
   * Registers incident and evaluates rate within sliding window.
   * @param {string} errType - 'ERR_CODE_HARDWARE_FAILURE' or 'ERR_CODE_APPLICATION_CRASH'
   * @param {string} contextMessage - Descriptive context (e.g. method or device ID)
   */
  registerIncident: (errType, contextMessage) => {
    const now = Date.now();
    
    // Normalize error type
    const normalizedType = errType === 'KOD_AWARIA_SPRZETU' ? 'ERR_CODE_HARDWARE_FAILURE'
      : errType === 'KOD_BLAD_PROGRAMISTYCZNY' ? 'ERR_CODE_APPLICATION_CRASH'
      : errType;

    if (!incidentRegistry[normalizedType]) {
      incidentRegistry[normalizedType] = [];
    }

    incidentRegistry[normalizedType].push(now);

    // Sliding window filter: purge entries older than window duration
    incidentRegistry[normalizedType] = incidentRegistry[normalizedType].filter(timestamp => now - timestamp <= TIME_WINDOW_MS);

    log.warn('incident.registered', {
      type: normalizedType,
      count_in_window: incidentRegistry[normalizedType].length,
      threshold: MAX_INCIDENTS,
    });

    // Trigger alert if threshold exceeded
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
   * Returns active alert list
   */
  getActiveAlerts: () => {
    return activeInfrastructureAlerts;
  },

  /**
   * Acknowledges and dismisses an alert by ID
   */
  clearAlert: (alertId) => {
    activeInfrastructureAlerts = activeInfrastructureAlerts.filter(a => a.id !== alertId);
    log.info('alert.acknowledged', { alert_id: alertId });
  },

  // Backward compatibility aliases
  rejestrujIncydent: (errType, msg) => anomalyMonitor.registerIncident(errType, msg),
  pobierzAktywneAlerty: () => anomalyMonitor.getActiveAlerts(),
  wyczyscAlert: (alertId) => anomalyMonitor.clearAlert(alertId)
};
