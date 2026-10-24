import test from 'node:test';
import assert from 'node:assert/strict';
import { validateMeasurement, describeContract } from '../contracts/measurement.contract.js';

const valid = () => ({
  raw_text: 'RESULT: GESTOSC: 832.4 KG/M3',
  parsed_density: 832.4,
  parsed_temperature: 15.1,
  status_paliwa: 'W NORMIE',
  comments: [],
  file_attachment: null,
});

test('contract accepts a valid measurement', () => {
  assert.deepEqual(validateMeasurement(valid()), { ok: true, errors: [] });
});

test('contract accepts a hardware fault record (ERR values)', () => {
  const doc = { ...valid(), parsed_density: 'ERR', parsed_temperature: 'ERR', status_paliwa: 'AWARIA APARATU (ERR)' };
  assert.equal(validateMeasurement(doc).ok, true);
});

test('contract rejects out-of-range density and names the field', () => {
  const result = validateMeasurement({ ...valid(), parsed_density: 5000 });
  assert.equal(result.ok, false);
  assert.match(result.errors[0], /parsed_density: 5000 outside 300\.\.1200/);
});

test('contract rejects NaN, missing fields, unknown status and unknown fields', () => {
  const { raw_text, ...withoutRaw } = valid();
  assert.equal(validateMeasurement({ ...valid(), parsed_temperature: NaN }).ok, false);
  assert.match(validateMeasurement(withoutRaw).errors[0], /raw_text: required/);
  assert.equal(validateMeasurement({ ...valid(), status_paliwa: 'OK' }).ok, false);
  assert.match(validateMeasurement({ ...valid(), extra: 1 }).errors[0], /extra: unknown field/);
});

test('contract rejects non-objects and oversized raw text', () => {
  assert.equal(validateMeasurement(null).ok, false);
  assert.equal(validateMeasurement({ ...valid(), raw_text: 'x'.repeat(5000) }).ok, false);
});

test('describeContract lists every field', () => {
  const doc = describeContract();
  for (const field of ['raw_text', 'parsed_density', 'status_paliwa']) assert.ok(doc.includes(field));
});
