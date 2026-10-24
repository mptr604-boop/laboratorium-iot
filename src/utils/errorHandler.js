// src/utils/errorHandler.js
// Global fail-safe telemetry and process-level exception boundary

import { dbOperations } from '../models/db.operations.js';
import { anomalyMonitor } from './anomalyMonitor.js';
import { createLogger } from './logger.js';

const ENV = process.env.NODE_ENV || 'development';
const log = createLogger('process');

export function initializeGlobalErrorHandler() {
  
  // 1. UNCAUGHT EXCEPTION BOUNDARY (e.g. ReferenceError, TypeError)
  process.on('uncaughtException', (err) => {
    log.error('uncaught_exception', { err });

    try {
      dbOperations.logDetectiveBug(ENV.toUpperCase(), `CRITICAL: ${err.message}`);
    } catch (dbErr) {
      log.error('crash_log.persist_failed', { err: dbErr });
    }

    anomalyMonitor.registerIncident('ERR_CODE_APPLICATION_CRASH', `File: ${err.stack ? err.stack.split('\n')[1].trim() : 'Unknown'}`);
  });

  // 2. UNHANDLED REJECTION BOUNDARY (Async/Await Promises)
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

// Backward compatibility alias
export const inicjalizujGlobalnyErrorHandler = initializeGlobalErrorHandler;
