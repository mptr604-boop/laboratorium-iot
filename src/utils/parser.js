// src/utils/parser.js
// Industrial RegEx parser with automatic hardware failure detection

import { createLogger } from './logger.js';

const log = createLogger('parser');

/**
 * Parses raw legacy laboratory measurement printout stream.
 * Supports standard measurement frames and explicit hardware error statuses ('err').
 * @param {string} rawText 
 * @returns {{ density: number|string, temperature: number|string, fuelStatus: string, gestosc: number|string, temperatura: number|string, status_paliwa: string }}
 */
export function parseLegacyDeviceOutput(rawText) {
  const text = rawText || '';

  // 1. HARDWARE FAILURE DETECTION (Device reports explicit 'err' / 'error')
  if (text.toLowerCase().includes('err') || text.toLowerCase().includes('error')) {
    log.warn('device.error_status', { reason: 'device printout contains err/error' });
    const errStatus = 'AWARIA APARATU (ERR)';
    return {
      density: 'ERR',
      temperature: 'ERR',
      fuelStatus: errStatus,
      // Backward compatibility aliases
      gestosc: 'ERR',
      temperatura: 'ERR',
      status_paliwa: errStatus
    };
  }

  // Regular expressions matching numerical parameters
  const densityRegex = /GESTOSC:\s*([0-9.]+)\s*KG\/M3/i;
  const tempRegex = /TEMP:\s*([0-9.]+)\s*C/i;

  const densityMatch = text.match(densityRegex);
  const tempMatch = text.match(tempRegex);

  // 2. CORRUPTED FRAME DETECTION (Missing required keywords)
  if (!densityMatch || !tempMatch) {
    const corruptStatus = 'USZKODZONA TRANSMISJA';
    return {
      density: 'ERR',
      temperature: 'ERR',
      fuelStatus: corruptStatus,
      gestosc: 'ERR',
      temperatura: 'ERR',
      status_paliwa: corruptStatus
    };
  }

  const density = parseFloat(densityMatch[1]);
  const temperature = parseFloat(tempMatch[1]);

  // Threshold monitor: Laboratory standard compliance (820-845 kg/m3 for Diesel)
  let fuelStatus = 'W NORMIE';
  if (density < 820 || density > 845) {
    fuelStatus = 'PRZEKROCZONE PARAMETRY';
  }

  return {
    density,
    temperature,
    fuelStatus,
    // Backward compatibility aliases
    gestosc: density,
    temperatura: temperature,
    status_paliwa: fuelStatus
  };
}

// Backward compatibility alias
export const parsujWydrukStaregoAparatu = parseLegacyDeviceOutput;
