// src/middlewares/auth.middleware.js
import { verifyJWT } from '../utils/jwt.js';

/**
 * Parses auth token from request cookies
 * @param {string|undefined} cookieHeader 
 * @returns {string|null}
 */
function getTokenFromCookies(cookieHeader) {
  if (!cookieHeader) return null;
  const cookies = cookieHeader.split(';');
  for (const c of cookies) {
    const [key, value] = c.trim().split('=');
    if (key === 'auth_token' && value) return decodeURIComponent(value);
  }
  return null;
}

/**
 * Role-Based Access Control (RBAC) middleware supporting Bearer headers and HttpOnly cookies
 * Supports English and Polish role identifiers (admin, senior_researcher / badacz_super, researcher / badacz, auditor / przegladajacy)
 * @param {import('node:http').IncomingMessage} req 
 * @param {string[]} allowedRoles 
 * @returns {Object|null}
 */
export function checkRoleAndPermissions(req, allowedRoles) {
  let token = null;

  // 1. Authorization header (REST API)
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.split(' ')[1];
  }

  // 2. Cookie fallback (Browser HTML forms / SSR)
  if (!token) {
    token = getTokenFromCookies(req.headers['cookie']);
  }

  if (!token) return null;

  const user = verifyJWT(token);
  if (!user) return null;

  // Role equivalence mapping for smooth transition
  const normalizedUserRole = user.role;
  const roleAliases = {
    'admin': ['admin'],
    'badacz_super': ['badacz_super', 'senior_researcher'],
    'senior_researcher': ['badacz_super', 'senior_researcher'],
    'badacz': ['badacz', 'researcher'],
    'researcher': ['badacz', 'researcher'],
    'przegladajacy': ['przegladajacy', 'auditor', 'viewer'],
    'auditor': ['przegladajacy', 'auditor', 'viewer'],
    'viewer': ['przegladajacy', 'auditor', 'viewer']
  };

  const userMatchingRoles = roleAliases[normalizedUserRole] || [normalizedUserRole];
  const hasAccess = allowedRoles.some(allowed => userMatchingRoles.includes(allowed));

  return hasAccess ? user : null;
}

// Backward compatibility alias
export const sprawdzUprawnieniaIRole = checkRoleAndPermissions;
