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
export function parseLegacyDeviceOutput(rawText, profile = 'fuel') {
  const text = rawText || '';
  if (profile === 'climate') return parseClimateOutput(text);

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

// Zakres pracy czujnika DHT11 według noty katalogowej. Odczyt spoza zakresu uznajemy za podejrzany,
// bo DHT11 nie ma sumy kontrolnej na linii tekstowej i zgubiony znak ("23.7" -> "2.7") wygląda jak zwykła liczba.
export const DHT11_RANGE = { temperature: [0, 50], humidity: [20, 90] };

// Linia z ESP32: "Temperatura: 23.7 C, Wilgotnosc: 42 %" albo "Blad odczytu z DHT11 ...".
function parseClimateOutput(text) {
  if (/blad odczytu|err/i.test(text)) {
    log.warn('device.error_status', { reason: 'climate sensor reported a read error' });
    return { kind: 'climate', temperature: 'ERR', humidity: 'ERR', fuelStatus: 'DEVICE_FAULT' };
  }

  const tempMatch = text.match(/TEMPERATURA:\s*(-?\d+(?:\.\d+)?)\s*C/i);
  const humMatch = text.match(/WILGOTNOSC:\s*(\d+(?:\.\d+)?)\s*%/i);
  if (!tempMatch || !humMatch) {
    return { kind: 'climate', temperature: 'ERR', humidity: 'ERR', fuelStatus: 'CORRUPTED_TRANSMISSION' };
  }

  const temperature = parseFloat(tempMatch[1]);
  const humidity = parseFloat(humMatch[1]);
  const [tMin, tMax] = DHT11_RANGE.temperature;
  const [hMin, hMax] = DHT11_RANGE.humidity;
  const inRange = temperature >= tMin && temperature <= tMax && humidity >= hMin && humidity <= hMax;
  return { kind: 'climate', temperature, humidity, fuelStatus: inRange ? 'NORMAL' : 'OUT_OF_SPEC' };
}

/**
 * Zamienia wynik parsera na pola dokumentu pomiaru (jedno miejsce dla TCP i HTTP).
 * Czujnik klimatu nie ma gęstości, więc pola `parsed_density` w ogóle nie ustawiamy.
 */
export function toMeasurementFields(parsed) {
  const fields = { parsed_temperature: parsed.temperature, fuel_status: parsed.fuelStatus };
  if (parsed.kind === 'climate') fields.parsed_humidity = parsed.humidity;
  else fields.parsed_density = parsed.density;
  return fields;
}

// Typ urządzenia w bazie decyduje o profilu parsera.
export const profileForDevice = (device) => (device?.type === 'climate_sensor' ? 'climate' : 'fuel');

/** Czy pomiar wymaga uwagi. Paliwo: progi gęstości. Czujnik klimatu: status zapisany przez parser. */
export function isFaultyMeasurement(data) {
  const density = data.parsed_density;
  if (density === undefined) return data.fuel_status !== 'NORMAL';
  return density === 'ERR' || density < 820 || density > 845;
}
