// src/utils/errorHandler.js
// Global fail-safe telemetry and process-level exception boundary

import { dbOperations } from '../models/db.operations.js';
import { anomalyMonitor } from './anomalyMonitor.js';

const ENV = process.env.NODE_ENV || 'development';

export function initializeGlobalErrorHandler() {
  
  // 1. UNCAUGHT EXCEPTION BOUNDARY (e.g. ReferenceError, TypeError)
  process.on('uncaughtException', (err) => {
    console.error(`[PROCESS-CRASH-BOUNDARY] 🚨 Uncaught exception intercepted:`, err);

    try {
      dbOperations.logDetectiveBug(ENV.toUpperCase(), `CRITICAL: ${err.message}`);
    } catch (dbErr) {
      console.error(`[ERROR-HANDLER-FAIL] Failed to persist crash log in SQLite:`, dbErr.message);
    }

    anomalyMonitor.registerIncident('ERR_CODE_APPLICATION_CRASH', `File: ${err.stack ? err.stack.split('\n')[1].trim() : 'Unknown'}`);
  });

  // 2. UNHANDLED REJECTION BOUNDARY (Async/Await Promises)
  process.on('unhandledRejection', (reason) => {
    const reasonMessage = reason instanceof Error ? reason.message : String(reason);
    console.error(`[ASYNC-CRASH-BOUNDARY] 🚨 Unhandled rejection intercepted:`, reason);

    try {
      dbOperations.logDetectiveBug(ENV.toUpperCase(), `ASYNC_REJECTION: ${reasonMessage}`);
    } catch (dbErr) {
      console.error(`[ERROR-HANDLER-FAIL] Failed to persist rejection log:`, dbErr.message);
    }

    anomalyMonitor.registerIncident('ERR_CODE_APPLICATION_CRASH', `Async Rejection: ${reasonMessage}`);
  });

  console.log(`[ERROR-HANDLER] 🛡️ Global fail-safe crash handler armed successfully.`);
}

// Backward compatibility alias
export const inicjalizujGlobalnyErrorHandler = initializeGlobalErrorHandler;
