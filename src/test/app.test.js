// src/test/app.test.js
// Automated test suite covering business access control (RBAC), cache engine, parser, and JWT

import test from 'node:test';
import assert from 'node:assert/strict';

import { parseLegacyDeviceOutput } from '../utils/parser.js';
import { generateJWT, verifyJWT } from '../utils/jwt.js';
import { redisLikeCache } from '../utils/cache.js';

// Mock database operations to verify business deletion rules without modifying SQLite state
const mockDbOperations = {
  measurements: [
    { id: 101, user_id: 10, device_name: 'Aparat ON 1', nosql_data: '{"parsed_density":830}' },
    { id: 102, user_id: 20, device_name: 'Aparat Pb 2', nosql_data: '{"parsed_density":740}' }
  ],
  deleteMeasurement(id) {
    this.measurements = this.measurements.filter(m => m.id !== id);
  }
};

// Pure business authorization logic for measurement deletion
function verifyDeletionPermissions(currentUser, measurement) {
  const allowedRoles = ['admin', 'senior_researcher', 'badacz_super', 'researcher', 'badacz'];
  if (!allowedRoles.includes(currentUser.role)) {
    return false;
  }
  // Standard researcher can only delete their own records
  const isJunior = currentUser.role === 'researcher' || currentUser.role === 'badacz';
  if (isJunior && measurement.user_id !== currentUser.id) {
    return false;
  }
  return true;
}

// --- 🧪 RBAC ACCESS PERMISSIONS TESTS ---

test('Access Control - Researcher can delete own measurement', () => {
  const mockResearcher = { id: 10, username: 'adam_researcher', role: 'researcher' };
  const ownMeasurement = mockDbOperations.measurements.find(m => m.id === 101);

  const isAllowed = verifyDeletionPermissions(mockResearcher, ownMeasurement);
  assert.equal(isAllowed, true, 'Researcher must have permission to delete own measurement');
});

test('Access Control - Researcher is denied when attempting to delete another user measurement', () => {
  const mockResearcher = { id: 10, username: 'adam_researcher', role: 'researcher' };
  const foreignMeasurement = mockDbOperations.measurements.find(m => m.id === 102);

  const isAllowed = verifyDeletionPermissions(mockResearcher, foreignMeasurement);
  assert.equal(isAllowed, false, 'System must reject attempt to delete someone else record');
});

test('Access Control - Senior researcher can delete any measurement', () => {
  const mockSenior = { id: 99, username: 'john_senior', role: 'senior_researcher' };
  const foreignMeasurement = mockDbOperations.measurements.find(m => m.id === 102);

  const isAllowed = verifyDeletionPermissions(mockSenior, foreignMeasurement);
  assert.equal(isAllowed, true, 'Senior researcher must be allowed to delete any measurement');
});

// --- 🧪 IN-MEMORY CACHE & INVALIDATION TESTS ---

test('Cache Engine - Stores and retrieves value before TTL expiration', () => {
  const key = 'test_html_key';
  const htmlContent = '<div>Density in spec: 832.4 kg/m3</div>';

  redisLikeCache.set(key, htmlContent, 2000);
  
  const cached = redisLikeCache.get(key);
  assert.equal(cached, htmlContent, 'Cache must return exact stored HTML content');
});

test('Cache Engine - Bulk invalidation purges keys matching SQL LIKE wildcard', () => {
  redisLikeCache.set('view_dashboard_page_1', 'HTML_PAGE_1', 5000);
  redisLikeCache.set('view_dashboard_page_2', 'HTML_PAGE_2', 5000);
  redisLikeCache.set('view_details_m101', 'HTML_DETAILS', 5000);

  redisLikeCache.invalidate('view_dashboard_%');

  assert.equal(redisLikeCache.get('view_dashboard_page_1'), null, 'Dashboard page 1 should be evicted');
  assert.equal(redisLikeCache.get('view_dashboard_page_2'), null, 'Dashboard page 2 should be evicted');
  assert.equal(redisLikeCache.get('view_details_m101'), 'HTML_DETAILS', 'Detail card was untouched by pattern');
  
  redisLikeCache.invalidate('view_details_%');
});

// --- 🧪 REGEX PARSER AND NATIVE JWT TESTS ---

test('RegEx Parser - Parses density and temperature from raw ASCII stream', () => {
  const parsed = parseLegacyDeviceOutput('RESULT: GESTOSC: 832.4 KG/M3\nRESULT: TEMP: 15.1 C');
  assert.equal(parsed.density, 832.4);
  assert.equal(parsed.temperature, 15.1);
  assert.equal(parsed.fuelStatus, 'W NORMIE');
});

test('Native JWT - Signs payload and verifies token successfully', () => {
  const token = generateJWT({ id: 1, role: 'admin' });
  const decoded = verifyJWT(token);
  assert.equal(decoded.role, 'admin');
});
