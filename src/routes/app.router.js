// src/routes/app.router.js
// Central HTTP request router dispatching SSR views, forms, and REST API actions
import fs from 'node:fs';
import path from 'node:path';
import { labController } from '../controllers/lab.controller.js';
import { viewController } from '../controllers/view.controller.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('router');
/**
 * Main HTTP router
 * @param {import('node:http').IncomingMessage} req 
 * @param {import('node:http').ServerResponse} res 
 */
export async function handleRouting(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);

  const sendJSON = (status, payload) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(payload));
  };

  // --- 1. SSR VIEW ROUTES (GET) ---
  
  // Root path redirect bypass
  if (req.method === 'GET' && url.pathname === '/') {
    const cookies = {};
    const cookieHeader = req.headers['cookie'];
    if (cookieHeader) {
      cookieHeader.split(';').forEach(c => {
        const [k, v] = c.trim().split('=');
        if (k && v) cookies[k] = decodeURIComponent(v);
      });
    }
    
    const targetRoute = cookies['auth_token'] ? '/dashboard' : '/login';
    res.writeHead(302, { 'Location': targetRoute });
    return res.end();
  }
  
  // GET /login (Login view)
  if (req.method === 'GET' && url.pathname === '/login') {
    const filePath = path.join(process.cwd(), 'src', 'views', 'login.html');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(fs.readFileSync(filePath, 'utf8'));
  }

  // GET /register (Staff registration view)
  if (req.method === 'GET' && url.pathname === '/register') {
    const filePath = path.join(process.cwd(), 'src', 'views', 'register.html');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(fs.readFileSync(filePath, 'utf8'));
  }

  // GET /dashboard (Main laboratory dashboard)
  if (req.method === 'GET' && url.pathname === '/dashboard') {
    return viewController.renderDashboard(req, res);
  }
  
  // GET /measurements/details (Measurement audit and details)
  if (req.method === 'GET' && url.pathname === '/measurements/details') {
    return viewController.renderDetails(req, res);
  }

  // --- 2. OPERATIONAL ROUTES (POST / REST API) ---
  
  // POST /login (Session processing)
  if (req.method === 'POST' && url.pathname === '/login') {
    return await labController.login(req, res);
  }

  // POST /register (Staff onboarding by Admin)
  if (req.method === 'POST' && url.pathname === '/register') {
    return await labController.register(req, res);
  }

  // POST /api/measurements/create (Save new measurement)
  if (req.method === 'POST' && url.pathname === '/api/measurements/create') {
    return await labController.createMeasurement(req, res);
  }

  // POST /api/measurements/delete (Delete record RBAC)
  if (req.method === 'POST' && url.pathname === '/api/measurements/delete') {
    return await labController.deleteMeasurement(req, res);
  }
  
  // POST /api/measurements/comment (Engineer audit notes)
  if (req.method === 'POST' && url.pathname === '/api/measurements/comment') {
    return await labController.addComment(req, res);
  }

  // --- PWA STATIC ASSETS ---
  
  // GET /manifest.json
  if (req.method === 'GET' && url.pathname === '/manifest.json') {
    const filePath = path.join(process.cwd(), 'src', 'views', 'manifest.json');
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(fs.readFileSync(filePath, 'utf8'));
  }

  // GET /sw.js
  if (req.method === 'GET' && url.pathname === '/sw.js') {
    const filePath = path.join(process.cwd(), 'src', 'views', 'sw.js');
    res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' });
    return res.end(fs.readFileSync(filePath, 'utf8'));
  }

  // POST /api/infrastructure/ack (Dismiss alert)
  if (req.method === 'POST' && url.pathname === '/api/infrastructure/ack') {
    return await labController.ackInfrastructureAlert(req, res);
  }

  // --- DIAGNOSTIC TEST TRIGGER ---
  if (req.method === 'GET' && url.pathname === '/api/test-crash') {
    log.debug('diagnostic.crash_trigger');
    const { dbDetective } = await import('../utils/detective.js');
    dbDetective.getUserByUsername(undefined);
    dbDetective.getUserByUsername(undefined);
    dbDetective.getUserByUsername(undefined);
    res.writeHead(302, { 'Location': '/dashboard' });
    return res.end();
  }

  return sendJSON(404, { error: 'Endpoint not found' });
}

// Backward compatibility alias
export const obsługujRouting = handleRouting;
