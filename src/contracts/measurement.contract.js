// src/contracts/measurement.contract.js
// Jedno źródło prawdy o tym, jak może wyglądać zapisany dokument pomiaru.
// Czytaj to jako dokumentację; saveMeasurement() wykonuje je też dla każdej ścieżki wejścia (TCP i HTTP).

export const HARDWARE_ERROR = 'ERR';

export const FUEL_STATUSES = [
  'NORMAL',
  'OUT_OF_SPEC',
  'CORRUPTED_TRANSMISSION',
  'DEVICE_FAULT',
  'PARSER_ERROR',
];

export const measurementContract = {
  raw_text: {
    type: 'string',
    required: true,
    maxLength: 4096,
    description: 'Raw printout exactly as sent by the instrument.',
  },
  parsed_density: {
    type: 'number',
    required: true,
    min: 300,
    max: 1200,
    unit: 'kg/m3',
    allowHardwareError: true,
    description: 'Density; "ERR" means the instrument reported a fault.',
  },
  parsed_temperature: {
    type: 'number',
    required: true,
    min: -50,
    max: 100,
    unit: 'C',
    allowHardwareError: true,
    description: 'Sample temperature; "ERR" means the instrument reported a fault.',
  },
  fuel_status: {
    type: 'string',
    required: true,
    oneOf: FUEL_STATUSES,
    description: 'Classification of the sample.',
  },
  comments: {
    type: 'array',
    required: true,
    description: 'Audit notes added by engineers.',
  },
  file_attachment: {
    type: 'object',
    required: false,
    nullable: true,
    description: 'Optional uploaded file.',
  },
};

function checkField(name, spec, value) {
  if (value === undefined) return spec.required ? `${name}: required` : null;
  if (value === null) return spec.nullable ? null : `${name}: must not be null`;
  if (spec.allowHardwareError && value === HARDWARE_ERROR) return null;

  if (spec.type === 'array') return Array.isArray(value) ? null : `${name}: expected array`;
  if (spec.type === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) return `${name}: expected a finite number or "${HARDWARE_ERROR}"`;
    if (value < spec.min || value > spec.max) return `${name}: ${value} outside ${spec.min}..${spec.max} ${spec.unit}`;
    return null;
  }
  if (typeof value !== spec.type || Array.isArray(value)) return `${name}: expected ${spec.type}`;
  if (spec.type === 'string') {
    if (spec.maxLength && value.length > spec.maxLength) return `${name}: longer than ${spec.maxLength} characters`;
    if (spec.oneOf && !spec.oneOf.includes(value)) return `${name}: unknown value "${value}"`;
  }
  return null;
}

/** Zwraca { ok, errors[] }. Pola spoza kontraktu są także odrzucane. */
export function validateMeasurement(doc) {
  if (doc === null || typeof doc !== 'object' || Array.isArray(doc)) {
    return { ok: false, errors: ['document: expected object'] };
  }
  const errors = [];
  for (const [name, spec] of Object.entries(measurementContract)) {
    const problem = checkField(name, spec, doc[name]);
    if (problem) errors.push(problem);
  }
  for (const name of Object.keys(doc)) {
    if (!(name in measurementContract)) errors.push(`${name}: unknown field`);
  }
  return { ok: errors.length === 0, errors };
}

export class ContractViolationError extends Error {
  constructor(errors) {
    super(`Measurement contract violated: ${errors.join('; ')}`);
    this.name = 'ContractViolationError';
    this.errors = errors;
  }
}

/** Tabela Markdown generowana z kontraktu, więc dokumentacja nie rozjedzie się z kodem. */
export function describeContract() {
  const rows = Object.entries(measurementContract).map(([name, s]) => {
    const rules = [
      s.required ? 'required' : 'optional',
      s.min !== undefined ? `${s.min}..${s.max} ${s.unit}` : null,
      s.maxLength ? `max ${s.maxLength} chars` : null,
      s.oneOf ? `one of: ${s.oneOf.join(', ')}` : null,
      s.allowHardwareError ? `or "${HARDWARE_ERROR}"` : null,
    ].filter(Boolean).join('; ');
    return `| ${name} | ${s.type} | ${rules} | ${s.description} |`;
  });
  return ['| Field | Type | Rules | Meaning |', '|---|---|---|---|', ...rows].join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(describeContract());
}
