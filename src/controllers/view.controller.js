// src/controllers/view.controller.js
// Kontroler renderowania po stronie serwera (SSR) z alertami telemetrii i cache

import fs from 'node:fs';
import path from 'node:path';
import { dbOperations } from '../models/db.operations.js';
import { getSessionUserFromRequest } from '../utils/session.js';
import { redisLikeCache } from '../utils/cache.js';
import { anomalyMonitor } from '../utils/anomalyMonitor.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('view');

export const viewController = {
  // GET /dashboard (dashboard z cache i monitorami telemetrii)
  renderDashboard: (req, res) => {
    const user = getSessionUserFromRequest(req);
    if (!user) {
      res.writeHead(302, { 'Location': '/login' });
      return res.end();
    }

    const url = new URL(req.url, `http://${req.headers.host}`);
    const search = url.searchParams.get('search') || '';
    const deviceType = url.searchParams.get('deviceType') || '';
    const sortBy = url.searchParams.get('sortBy') || 'created_at';
    const order = url.searchParams.get('order') || 'DESC';
    const page = parseInt(url.searchParams.get('page') || '1', 10);

    const cacheKey = `view_dashboard_u${user.id}_s${search}_t${deviceType}_o${sortBy}_p${page}`;

    // Pominięcie cache, gdy są aktywne alerty sprzętowe lub systemowe
    const activeAlerts = anomalyMonitor.getActiveAlerts();
    let cachedHTML = null;
    if (activeAlerts.length === 0) {
      cachedHTML = redisLikeCache.get(cacheKey);
    } else {
      log.info('dashboard.cache_bypass', { reason: 'active_alerts', active_alerts: activeAlerts.length });
    }

    if (cachedHTML) {
      log.debug('dashboard.cache_hit');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'X-Cache': 'HIT' });
      return res.end(cachedHTML);
    }

    log.debug('dashboard.cache_miss');
    const limit = 5; 
    const offset = (page - 1) * limit;

    const measurements = dbOperations.getMeasurementsAdvanced({ search, deviceType, sortBy, order, limit, offset });
    const totalCount = dbOperations.countMeasurements(search, deviceType);

    // 1. RENDEROWANIE ALERTÓW INFRASTRUKTURY
    let infrastructureAlertsHTML = '';
    activeAlerts.forEach(alert => {
      let btnAckHTML = '';
      if (['admin', 'badacz_super', 'senior_researcher'].includes(user.role)) {
        btnAckHTML = `
          <form method="POST" action="/api/infrastructure/ack" style="margin:0;" onclick="event.stopPropagation();">
            <input type="hidden" name="id" value="${alert.id}">
            <button type="submit" class="btn-ack">Zatwierdź i Wyczyść</button>
          </form>
        `;
      }
      infrastructureAlertsHTML += `
        <div class="alert-block alert-block-critical">
          <span>${alert.komunikat || alert.message} (<small>${alert.timestamp}</small>)</span>
          ${btnAckHTML}
        </div>
      `;
    });

    // 2. MONITOR PROGÓW JAKOŚCI PALIWA
    const allMeasurements = dbOperations.getMeasurementsAdvanced({ limit: 99999, offset: 0 });
    const faultySamples = allMeasurements.filter(m => m.data.parsed_density < 820 || m.data.parsed_density > 845 || m.data.parsed_density === 'ERR');
    
    let alertsBlockHTML = '';
    if (faultySamples.length > 0) {
      const deviceNames = [...new Set(faultySamples.map(m => m.device_name))].join(', ');
      alertsBlockHTML = `
        <div class="alert-block alert-block-danger">
          <span>⚠️ KRYTYCZNY ALARM MONITORINGU PROGÓW! Wykryto skażenie lub awarię aparatów w ${faultySamples.length} próbkach! Urządzenia: [ ${deviceNames} ]</span>
        </div>
      `;
    } else {
      alertsBlockHTML = `
        <div class="alert-block alert-block-success">
          <span>✅ STATUS SYSTEMU: Wszystkie próbki paliw znajdują się w normie laboratoryjnej (820 - 845 kg/m³).</span>
        </div>
      `;
    }

    let tableRowsHTML = '';
    if (measurements.length === 0) {
      tableRowsHTML = `<tr><td colspan="7" style="text-align:center; color:#888; padding:30px;">Brak wyników spełniających kryteria.</td></tr>`;
    } else {
      measurements.forEach(m => {
        const isFaulty = m.data.parsed_density < 820 || m.data.parsed_density > 845 || m.data.parsed_density === 'ERR';
        const rowClass = isFaulty ? 'class="alert-row"' : '';
        const isOwner = m.user_id === user.id;
        const canDelete = ['admin', 'badacz_super', 'senior_researcher'].includes(user.role) || (['badacz', 'researcher'].includes(user.role) && isOwner);

        let actionButtons = '';
        if (canDelete) {
          actionButtons += `
            <form method="POST" action="/api/measurements/delete" style="display:inline;" onclick="event.stopPropagation();">
              <input type="hidden" name="id" value="${m.id}">
              <button type="submit" class="btn-akcja btn-usun" onclick="return confirm('Usunąć pomiar ID ${m.id}?')">Usuń</button>
            </form>
          `;
        } else {
          actionButtons = '<span style="color:#aaa; font-style:italic;">Brak praw</span>';
        }

        const displayDensity = m.data.parsed_density === 'ERR' ? '<span style="color:#dc3545; font-weight:bold;">AWARIA (ERR)</span>' : `${m.data.parsed_density} kg/m³`;
        const displayTemp = m.data.parsed_temperature === 'ERR' ? 'ERR' : `${m.data.parsed_temperature}`;

        tableRowsHTML += `
          <tr ${rowClass} onclick="window.location='/measurements/details?id=${m.id}'">
            <td><a href="/measurements/details?id=${m.id}" class="id-link" onclick="event.stopPropagation();">#${m.id}</a></td>
            <td>Zlecono: ${m.created_at}<br><small style="color:#6c757d;">Mod: ${m.updated_at}</small></td>
            <td><strong>${m.device_name}</strong></td>
            <td><code>${m.device_type}</code></td>
            <td>${m.creator_name} ${isOwner ? '<small style="color:#28a745;">(Ty)</small>' : ''}</td>
            <td><strong>${displayDensity}</strong><br><small>Temp: ${displayTemp} °C</small></td>
            <td>${actionButtons}</td>
          </tr>
        `;
      });
    }

    const maxPages = Math.ceil(totalCount / limit) || 1;
    let paginationButtonsHTML = '';
    
    if (page > 1) {
      url.searchParams.set('page', page - 1);
      paginationButtonsHTML += `<a href="${url.pathname}${url.search}" style="padding:6px 12px; background:#007bff; color:#fff; text-decoration:none; border-radius:4px; font-weight:bold; font-size:13px;">« Poprzednia</a>`;
    } else {
      paginationButtonsHTML += `<span style="padding:6px 12px; background:#e9ecef; color:#6c757d; border-radius:4px; font-size:13px; font-weight:bold; cursor:not-allowed;">« Poprzednia</span>`;
    }
    
    if (page < maxPages) {
      url.searchParams.set('page', page + 1);
      paginationButtonsHTML += `<a href="${url.pathname}${url.search}" style="padding:6px 12px; background:#007bff; color:#fff; text-decoration:none; border-radius:4px; font-weight:bold; font-size:13px;">Następna »</a>`;
    } else {
      paginationButtonsHTML += `<span style="padding:6px 12px; background:#e9ecef; color:#6c757d; border-radius:4px; font-size:13px; font-weight:bold; cursor:not-allowed;">Następna »</span>`;
    }

    const adminRegisterLink = user.role === 'admin' ? `<a href="/register" class="btn-link">Panel Rejestracji</a>` : '';

    let addMeasurementFormHTML = '';
    if (['admin', 'badacz_super', 'senior_researcher', 'badacz', 'researcher'].includes(user.role)) {
      addMeasurementFormHTML = `
        <div class="form-dodaj-pomiar">
          <h3>Zlecenie i Rejestracja Nowego Badania Paliwa</h3>
          <form method="POST" action="/api/measurements/create" class="form-grid">
            <div class="pole">
              <label>Aparat Laboratoryjny</label>
              <select name="deviceId" required style="padding: 8px; border-radius: 4px; border: 1px solid #ced4da; font-size:14px;">
                <option value="1">Aparat Distyl Diesel 9000 (legacy_print)</option>
              </select>
            </div>
            <div class="pole" style="flex-grow: 1;">
              <label>Surowy Tekst Wydruku (Format: GESTOSC: XXX.X KG/M3\\nTEMP: XX.X C lub 'ERR')</label>
              <input type="text" name="rawText" required placeholder="np. RESULT: GESTOSC: 834.2 KG/M3\\nRESULT: TEMP: 15.6 C" style="padding: 8px; border-radius: 4px; border: 1px solid #ced4da; font-size:14px; width:100%; box-sizing:border-box;">
            </div>
            <button type="submit" style="background: #28a745; color: white; padding: 9px 16px; border: none; border-radius: 4px; font-weight: bold; cursor: pointer; font-size:14px; height:37px;">Zapisz i Przetwórz</button>
          </form>
        </div>
      `;
    }

    const templatePath = path.join(process.cwd(), 'src', 'views', 'dashboard.html');
    let html = fs.readFileSync(templatePath, 'utf8');

    html = html
      .replace('{{USERNAME}}', user.username)
      .replace('{{ROLE}}', user.role)
      .replace('{{ADMIN_REGISTER_LINK}}', adminRegisterLink)
      .replace('{{CRITICAL_INFRASTRUCTURE_ALERTS}}', infrastructureAlertsHTML)
      .replace('{{THRESHOLD_ALERTS_BLOCK}}', alertsBlockHTML)
      .replace('{{ADD_MEASUREMENT_FORM}}', addMeasurementFormHTML)
      .replace('{{SEARCH_VALUE}}', search)
      .replace('{{TOTAL_RECORDS}}', totalCount)
      .replace('{{OFFSET_START}}', totalCount === 0 ? 0 : offset + 1)
      .replace('{{OFFSET_END}}', Math.min(offset + limit, totalCount))
      .replace('{{TABLE_ROWS}}', tableRowsHTML)
      .replace('{{PAGINATION_BUTTONS}}', paginationButtonsHTML)
      .replace('{{SEL_LEGACY}}', deviceType === 'legacy_print' ? 'selected' : '')
      .replace('{{SEL_JSON}}', deviceType === 'modern_json' ? 'selected' : '')
      .replace('{{SO_DATE}}', sortBy === 'created_at' ? 'selected' : '')
      .replace('{{SO_UPDATE}}', sortBy === 'updated_at' ? 'selected' : '')
      .replace('{{SO_ID}}', sortBy === 'id' ? 'selected' : '')
      .replace('{{OR_DESC}}', order === 'DESC' ? 'selected' : '')
      .replace('{{OR_ASC}}', order === 'ASC' ? 'selected' : '');

    redisLikeCache.set(cacheKey, html, 10000);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'X-Cache': 'MISS' });
    res.end(html);
  },

  // GET /measurements/details
  renderDetails: (req, res) => {
    const user = getSessionUserFromRequest(req);
    if (!user) {
      res.writeHead(302, { 'Location': '/login' });
      return res.end();
    }

    const url = new URL(req.url, `http://${req.headers.host}`);
    const id = parseInt(url.searchParams.get('id') || '0', 10);

    const cacheKeyDetails = `view_details_m${id}_u${user.id}`;
    const cachedDetails = redisLikeCache.get(cacheKeyDetails);
    if (cachedDetails) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'X-Cache': 'HIT' });
      return res.end(cachedDetails);
    }

    const m = dbOperations.getMeasurementById(id);
    if (!m) {
      res.writeHead(302, { 'Location': '/dashboard?error=' + encodeURIComponent('Nie odnaleziono pomiaru.') });
      return res.end();
    }

    const nosqlData = JSON.parse(m.nosql_data);
    
    let attachmentHTML = '<span style="color:#aaa; font-style:italic;">Brak załączników dokumentacji dla tego badania.</span>';
    if (nosqlData.file_attachment) {
      attachmentHTML = `
        <div style="background: #fff3cd; padding: 12px; border-radius: 4px; border: 1px solid #ffeba2; margin-top: 10px; font-size: 14px;">
          📁 <strong>Załączony dokument laboratoryjny:</strong> 
          <span style="color: #856404; font-family: monospace;">${nosqlData.file_attachment.originalName}</span> 
          (<small>${(nosqlData.file_attachment.size / 1024).toFixed(1)} KB</small>)
          <span style="margin-left: 10px; color: #6c757d; font-style: italic;">[Zabezpieczono na dysku w wolumenie LIMS]</span>
        </div>
      `;
    }

    const isFaulty = nosqlData.parsed_density < 820 || nosqlData.parsed_density > 845 || nosqlData.parsed_density === 'ERR';
    const badgeHTML = isFaulty ? '<span class="status-badge status-alert">PRZEKROCZONE PARAMETRY</span>' : '<span class="status-badge status-norma">W NORMIE</span>';
    const commentsHTML = (nosqlData.comments || [])
      .map(c => `<div class="komentarz-wpis"><strong>[${c.user}]:</strong> ${c.text}</div>`)
      .join('') || '<span style="color:#aaa; font-style:italic;">Brak uwag technicznych dla tego badania.</span>';

    const templatePath = path.join(process.cwd(), 'src', 'views', 'details.html');
    let html = fs.readFileSync(templatePath, 'utf8');

    const displayDensity = nosqlData.parsed_density === 'ERR' ? 'AWARIA APARATU' : nosqlData.parsed_density;
    const displayTemp = nosqlData.parsed_temperature === 'ERR' ? 'AWARIA' : nosqlData.parsed_temperature;

    html = html
      .replace(/{{MEASUREMENT_ID}}/g, m.id)
      .replace('{{CREATOR_NAME}}', m.creator_name)
      .replace('{{CREATED_AT}}', m.created_at)
      .replace('{{DEVICE_NAME}}', m.device_name)
      .replace('{{DEVICE_TYPE}}', m.device_type)
      .replace('{{STATUS_BADGE}}', badgeHTML)
      .replace('{{PARSED_DENSITY}}', displayDensity)
      .replace('{{PARSED_TEMP}}', displayTemp)
      .replace('{{RAW_TEXT}}', nosqlData.raw_text || 'Brak surowego zrzutu')
      .replace('{{COMMENTS_LIST}}', commentsHTML)
      .replace('{{FILE_ATTACHMENT_BLOCK}}', attachmentHTML);

    redisLikeCache.set(cacheKeyDetails, html, 10000);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'X-Cache': 'MISS' });
    res.end(html);
  }
};
