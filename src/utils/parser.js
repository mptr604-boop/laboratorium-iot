// src/utils/parser.js
// Przemysłowy parser RegEx z automatycznym wykrywaniem awarii sprzętu

import { createLogger } from './logger.js';

const log = createLogger('parser');

/**
 * Parsuje surowy strumień wydruku ze starego aparatu laboratoryjnego.
 * Obsługuje standardowe ramki pomiarowe oraz jawne statusy awarii sprzętu ('err').
 * @param {string} rawText 
 * @returns {{ density: number|string, temperature: number|string, fuelStatus: 'NORMAL'|'OUT_OF_SPEC'|'CORRUPTED_TRANSMISSION'|'DEVICE_FAULT' }}
 */
export function parseLegacyDeviceOutput(rawText) {
  const text = rawText || '';

  // 1. WYKRYWANIE AWARII SPRZĘTU (aparat zgłasza jawnie 'err' / 'error')
  if (text.toLowerCase().includes('err') || text.toLowerCase().includes('error')) {
    log.warn('device.error_status', { reason: 'device printout contains err/error' });
    return { density: 'ERR', temperature: 'ERR', fuelStatus: 'DEVICE_FAULT' };
  }

  // Wyrażenia regularne wyciągające parametry liczbowe
  const densityRegex = /GESTOSC:\s*([0-9.]+)\s*KG\/M3/i;
  const tempRegex = /TEMP:\s*([0-9.]+)\s*C/i;

  const densityMatch = text.match(densityRegex);
  const tempMatch = text.match(tempRegex);

  // 2. WYKRYWANIE USZKODZONEJ RAMKI (brak wymaganych słów kluczowych)
  if (!densityMatch || !tempMatch) {
    return { density: 'ERR', temperature: 'ERR', fuelStatus: 'CORRUPTED_TRANSMISSION' };
  }

  const density = parseFloat(densityMatch[1]);
  const temperature = parseFloat(tempMatch[1]);

  // Monitor progów: zgodność z normą laboratoryjną (820-845 kg/m3 dla oleju napędowego)
  const fuelStatus = density < 820 || density > 845 ? 'OUT_OF_SPEC' : 'NORMAL';

  return { density, temperature, fuelStatus };
}
