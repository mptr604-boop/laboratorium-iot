// src/utils/errorHandler.js
// Globalna telemetria błędów i ochrona przed wyjątkami na poziomie procesu

import { dbOperations } from '../models/db.operations.js';
import { anomalyMonitor } from './anomalyMonitor.js';
import { createLogger } from './logger.js';

const ENV = process.env.NODE_ENV || 'development';
const log = createLogger('process');

export function initializeGlobalErrorHandler() {
  
  // 1. NIEOBSŁUŻONE WYJĄTKI (np. ReferenceError, TypeError)
  process.on('uncaughtException', (err) => {
    log.error('uncaught_exception', { err });

    try {
      dbOperations.logDetectiveBug(ENV.toUpperCase(), `CRITICAL: ${err.message}`);
    } catch (dbErr) {
      log.error('crash_log.persist_failed', { err: dbErr });
    }

    anomalyMonitor.registerIncident('ERR_CODE_APPLICATION_CRASH', `File: ${err.stack ? err.stack.split('\n')[1].trim() : 'Unknown'}`);
  });

  // 2. NIEOBSŁUŻONE ODRZUCENIA (Promise, async/await)
  process.on('unhandledRejection', (reason) => {
    const reasonMessage = reason instanceof Error ? reason.message : String(reason);
    log.error('unhandled_rejection', { err: reason instanceof Error ? reason : reasonMessage });

    try {
      dbOperations.logDetectiveBug(ENV.toUpperCase(), `ASYNC_REJECTION: ${reasonMessage}`);
    } catch (dbErr) {
      log.error('rejection_log.persist_failed', { err: dbErr });
    }

    anomalyMonitor.registerIncident('ERR_CODE_APPLICATION_CRASH', `Async Rejection: ${reasonMessage}`);
  });

  log.info('crash_handler.armed');
}

// Alias zachowujący kompatybilność wsteczną
export const inicjalizujGlobalnyErrorHandler = initializeGlobalErrorHandler;
