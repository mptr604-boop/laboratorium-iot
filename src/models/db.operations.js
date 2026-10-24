// src/models/db.operations.js (Część 1)
import { db } from '../config/database.js';
import { validateMeasurement, ContractViolationError } from '../contracts/measurement.contract.js';

// --- AKTUALIZACJA STRUKTURY TABEL Z KOLUMNĄ UPDATED_AT ---
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT, 
    username TEXT UNIQUE NOT NULL, 
    password_hash TEXT NOT NULL, 
    role TEXT NOT NULL
  );
  
  CREATE TABLE IF NOT EXISTS devices (
    id INTEGER PRIMARY KEY AUTOINCREMENT, 
    token TEXT UNIQUE NOT NULL, 
    name TEXT NOT NULL, 
    type TEXT NOT NULL
  );
  
  CREATE TABLE IF NOT EXISTS measurements (
    id INTEGER PRIMARY KEY AUTOINCREMENT, 
    device_id INTEGER NOT NULL, 
    user_id INTEGER NOT NULL, 
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP, 
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP, -- Czas modyfikacji dokumentu NoSQL
    nosql_data TEXT NOT NULL, 
    FOREIGN KEY(device_id) REFERENCES devices(id),
    FOREIGN KEY(user_id) REFERENCES users(id)
  );
  
  CREATE TABLE IF NOT EXISTS detective_bugs (
    id INTEGER PRIMARY KEY AUTOINCREMENT, 
    environment TEXT NOT NULL, 
    error_context TEXT NOT NULL, 
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

export const dbOperations = {
  createUser: (username, hash, role) => {
    const stmt = db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)');
    return stmt.run(username, hash, role);
  },
  
  updateUserPasswordHash: (id, hash) => {
    return db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, id);
  },

  getUserByUsername: (username) => {
    const stmt = db.prepare('SELECT * FROM users WHERE username = ?');
    return stmt.get(username);
  },
  
  createDevice: (token, name, type) => {
    const stmt = db.prepare('INSERT INTO devices (token, name, type) VALUES (?, ?, ?)');
    return stmt.run(token, name, type);
  },
  
  getDeviceByToken: (token) => {
    const stmt = db.prepare('SELECT * FROM devices WHERE token = ?');
    return stmt.get(token);
  },
  
  saveMeasurement: (deviceId, userId, nosqlObj) => {
    // Jedyna brama zapisu (TCP i HTTP): dokument musi spełniać kontrakt.
    const verdict = validateMeasurement(nosqlObj);
    if (!verdict.ok) throw new ContractViolationError(verdict.errors);
    // Przy nowym zapisie updated_at dostaje domyślnie identyczny czas jak created_at
    const stmt = db.prepare('INSERT INTO measurements (device_id, user_id, nosql_data) VALUES (?, ?, ?)');
    return stmt.run(deviceId, userId, JSON.stringify(nosqlObj));
  },
  
  getMeasurementById: (id) => {
    const stmt = db.prepare(`
      SELECT m.id, m.created_at, m.updated_at, m.nosql_data, m.user_id, u.username as creator_name, d.name as device_name, d.type as device_type
      FROM measurements m
      JOIN users u ON m.user_id = u.id
      JOIN devices d ON m.device_id = d.id
      WHERE m.id = ?
    `);
    return stmt.get(id);
  },

  deleteMeasurement: (id) => {
    const stmt = db.prepare('DELETE FROM measurements WHERE id = ?');
    return stmt.run(id);
  },
// src/models/db.operations.js (Część 2)

  // AKTUALIZACJA DOKUMENTU JSON: Wstrzykujemy komentarz i wymuszamy odświeżenie updated_at
  addCommentToMeasurement: (id, commentObj) => {
    const selectStmt = db.prepare('SELECT nosql_data FROM measurements WHERE id = ?');
    const row = selectStmt.get(id);
    if (!row) return null;
    
    const currentData = JSON.parse(row.nosql_data);
    currentData.comments = currentData.comments || [];
    currentData.comments.push(commentObj);
    
    // Jawnie odświeżamy updated_at czasem UTC bazy danych
    const updateStmt = db.prepare(`
      UPDATE measurements 
      SET nosql_data = ?, updated_at = CURRENT_TIMESTAMP 
      WHERE id = ?
    `);
    return updateStmt.run(JSON.stringify(currentData), id);
  },

  // ZAAWANSOWANE ZAPYTANIE: Wyciągamy z bazy zarówno created_at, jak i updated_at
  getMeasurementsAdvanced: ({ search = '', deviceType = '', sortBy = 'created_at', order = 'DESC', limit = 10, offset = 0 }) => {
    const allowedSortColumns = ['id', 'created_at', 'updated_at', 'device_name'];
    const finalSortBy = allowedSortColumns.includes(sortBy) ? sortBy : 'created_at';
    const finalOrder = order.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    let query = `
      SELECT m.id, m.created_at, m.updated_at, m.nosql_data, m.user_id, u.username as creator_name, d.name as device_name, d.type as device_type
      FROM measurements m
      JOIN users u ON m.user_id = u.id
      JOIN devices d ON m.device_id = d.id
      WHERE (d.name LIKE ? OR m.nosql_data LIKE ? OR u.username LIKE ?)
    `;
    
    const params = [`%${search}%`, `%${search}%`, `%${search}%`];

    if (deviceType) {
      query += ` AND d.type = ?`;
      params.push(deviceType);
    }

    query += ` ORDER BY ${finalSortBy === 'device_name' ? 'd.name' : 'm.' + finalSortBy} ${finalOrder} LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    const stmt = db.prepare(query);
    const rows = stmt.all(...params);
    return rows.map(r => ({
      id: r.id,
      user_id: r.user_id,
      creator_name: r.creator_name,
      device_name: r.device_name,
      device_type: r.device_type,
      created_at: r.created_at,
      updated_at: r.updated_at, // Mapujemy nową kolumnę czasową
      data: JSON.parse(r.nosql_data)
    }));
  },

  countMeasurements: (search = '', deviceType = '') => {
    let query = `
      SELECT COUNT(*) as total 
      FROM measurements m 
      JOIN devices d ON m.device_id = d.id 
      JOIN users u ON m.user_id = u.id
      WHERE (d.name LIKE ? OR m.nosql_data LIKE ? OR u.username LIKE ?)
    `;
    const params = [`%${search}%`, `%${search}%`, `%${search}%`];
    if (deviceType) {
      query += ` AND d.type = ?`;
      params.push(deviceType);
    }
    const stmt = db.prepare(query);
    return stmt.get(...params).total;
  },

  logDetectiveBug: (env, context) => {
    const stmt = db.prepare('INSERT INTO detective_bugs (environment, error_context) VALUES (?, ?)');
    return stmt.run(env, context);
  }
};
