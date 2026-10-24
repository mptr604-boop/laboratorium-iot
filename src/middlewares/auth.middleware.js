// src/middlewares/auth.middleware.js
import { getSessionUserFromRequest } from '../utils/session.js';

/**
 * Role-Based Access Control (RBAC) na podstawie sesji z ciasteczka HttpOnly.
 * Obsługuje angielskie i polskie nazwy ról (admin, senior_researcher / badacz_super, researcher / badacz, auditor / przegladajacy)
 * @param {import('node:http').IncomingMessage} req
 * @param {string[]} allowedRoles
 * @returns {Object|null}
 */
export function checkRoleAndPermissions(req, allowedRoles) {
  const user = getSessionUserFromRequest(req);
  if (!user) return null;

  // Mapowanie równoważnych ról dla płynnego przejścia
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

// Alias zachowujący kompatybilność wsteczną
export const sprawdzUprawnieniaIRole = checkRoleAndPermissions;
