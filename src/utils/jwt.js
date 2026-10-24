// src/utils/jwt.js
import crypto from 'node:crypto';

const JWT_SECRET = process.env.JWT_SECRET || 'lab_jwt_dev_secret_change_in_production_2026';

/**
 * Generuje natywny token JWT z podpisem HMAC SHA-256
 * @param {Object} payload 
 */
export function generujJWT(payload) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const base64Header = Buffer.from(JSON.stringify(header)).toString('base64url');
  const base64Payload = Buffer.from(JSON.stringify(payload)).toString('base64url');
  
  const signature = crypto
    .createHmac('sha256', JWT_SECRET)
    .update(`${base64Header}.${base64Payload}`)
    .digest('base64url');
    
  return `${base64Header}.${base64Payload}.${signature}`;
}

/**
 * PANCERNA WERYFIKACJA JWT ODPORNA NA STRUKTURY CIASTECZEK
 * @param {string} token 
 */
export function weryfikujJWT(token) {
  try {
    if (!token || typeof token !== 'string') return null;

    // POPRAWKA: Jeśli token został przekazany z nagłówka Bearer lub zawiera spacje, wycinamy czysty ciąg
    let czystyToken = token.trim();
    if (czystyToken.startsWith('Bearer ')) {
      czystyToken = czystyToken.substring(7);
    }

    const czesci = czystyToken.split('.');
    if (czesci.length !== 3) return null;

    const [base64Header, base64Payload, signature] = czesci;
    
    // Odtwarzamy podpis i weryfikujemy sumę kontrolną
    const expectedSignature = crypto
      .createHmac('sha256', JWT_SECRET)
      .update(`${base64Header}.${base64Payload}`)
      .digest('base64url');
      
    if (signature !== expectedSignature) {
      console.error("[JWT-ERROR] Wykryto niepoprawny lub zmodyfikowany podpis cyfrowy tokenu!");
      return null;
    }

    return JSON.parse(Buffer.from(base64Payload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

// English naming aliases
export const generateJWT = generujJWT;
export const verifyJWT = weryfikujJWT;
