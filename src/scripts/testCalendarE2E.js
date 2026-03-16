/**
 * E2E test: Calendar scheduling from chatbot/WhatsApp flow.
 * Tests: GET availability (HMAC), response shape (CommonViewModel), optional POST book / DELETE cancel.
 * Run: node src/scripts/testCalendarE2E.js [appId]
 * Requires: BACKEND_URL (default http://localhost:5000), THIRD_PARTY_SIGNING_SECRET in env (or .env).
 *
 * How to test with Google Calendar connected:
 * 1. Ensure backend is running and .env has THIRD_PARTY_SIGNING_SECRET, GOOGLE_CALENDAR_CLIENT_ID,
 *    GOOGLE_CALENDAR_CLIENT_SECRET, GOOGLE_CALENDAR_REDIRECT_URI, ENCRYPTION_KEY.
 * 2. Create or pick an App in the DB and note its _id (appId).
 * 3. Connect Google Calendar for that app: log in to the app, go to Integration/Settings, use "Connect
 *    Google Calendar" (or call GET /api/v1/integration/apps/:appId/calendar/auth-url with Bearer token
 *    and redirect the user to the returned url). Complete OAuth; callback saves the refresh token.
 * 4. Run: node src/scripts/testCalendarE2E.js <appId>
 *    You should see GET availability with freeSlots/busy, POST book creating an event, DELETE cancel
 *    (use a real eventId from a previous book if you want to verify cancel).
 */
require('dotenv').config();
const crypto = require('crypto');
const http = require('http');
const https = require('https');

const APP_ID = process.argv[2] || '000000000000000000000001'; // placeholder if no app in DB
const BASE_URL = process.env.BACKEND_URL || process.env.API_BASE_URL || 'http://localhost:5000';
const SECRET = process.env.THIRD_PARTY_SIGNING_SECRET || '';

function generateNonce() {
  return require('crypto').randomBytes(16).toString('hex');
}
function generateTs() {
  return String(Date.now());
}
function buildSignature(method, path, appId, ts, nonce) {
  const toSign = `${method}\n${path}\nappId=${appId}\n${ts}\n${nonce}`;
  return crypto.createHmac('sha256', SECRET || 'test-secret').update(toSign).digest('hex');
}

function request(method, path, query, body, headers = {}) {
  const pathOnly = path.startsWith('http') ? new URL(path).pathname : path;
  const url = new URL(pathOnly, BASE_URL);
  if (query) Object.entries(query).forEach(([k, v]) => url.searchParams.set(k, v));
  const isHttps = url.protocol === 'https:';
  const lib = isHttps ? https : http;
  const ts = generateTs();
  const nonce = generateNonce();
  const sign = buildSignature(method, pathOnly, APP_ID, ts, nonce);
  const defaultHeaders = {
    'x-tp-ts': ts,
    'x-tp-nonce': nonce,
    'x-tp-sign': sign,
    'accept': 'application/json',
    ...(body && { 'Content-Type': 'application/json' }),
    ...headers
  };
  return new Promise((resolve, reject) => {
    const req = lib.request(url, { method, headers: defaultHeaders }, (res) => {
      let data = '';
      res.on('data', (ch) => (data += ch));
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, headers: res.headers, body: data ? JSON.parse(data) : {} });
        } catch (e) {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}

async function run() {
  const report = { passed: [], failed: [], warnings: [] };

  if (!SECRET) report.warnings.push('THIRD_PARTY_SIGNING_SECRET not set; using test-secret (backend must accept or skip verify in dev).');

  // 0) Backend reachable
  try {
    const u = new URL('/api/v1', BASE_URL);
    const lib = u.protocol === 'https:' ? https : http;
    await new Promise((resolve, reject) => {
      const r = lib.get(u, (res) => { let d = ''; res.on('data', c => d += c); res.on('end', () => resolve({ status: res.statusCode })); });
      r.on('error', reject);
    });
    report.passed.push('Backend reachable at ' + BASE_URL);
  } catch (e) {
    report.failed.push({ test: 'Backend reachable', error: e.message, code: e.code });
    return report;
  }

  const pathBase = '/api/v1/calendar/apps/' + APP_ID;

  // 1) GET availability – must return CommonViewModel shape
  try {
    const fromDate = new Date();
    fromDate.setHours(0, 0, 0, 0);
    const toDate = new Date(fromDate);
    toDate.setDate(toDate.getDate() + 7);
    const path = pathBase + '/availability';
    const res = await request('GET', path, {
      from: fromDate.toISOString(),
      to: toDate.toISOString(),
      slotMinutes: '30'
    });
    if (res.status !== 200) {
      report.failed.push({ test: 'GET availability', error: `status ${res.status}`, body: res.body, note: res.body?.message || res.body?.error });
    } else {
      const d = res.body?.data || res.body;
      const hasShape = d && typeof d.success !== 'undefined' && Array.isArray(d.freeSlots) && Array.isArray(d.busy);
      if (!hasShape) report.failed.push({ test: 'GET availability', error: 'Response not CommonViewModel (need success, freeSlots[], busy[])', body: d });
      else report.passed.push('GET availability: 200, CommonViewModel (success, freeSlots, busy)');
      if (d && !d.calendarConnected) report.warnings.push('No calendar connected for this app (expected if no OAuth done).');
    }
  } catch (e) {
    report.failed.push({ test: 'GET availability', error: e.message, code: e.code });
  }

  // 2) POST book appointment – must return BookAppointmentViewModel or error
  try {
    const path = pathBase + '/appointments';
    const start = new Date();
    start.setHours(10, 0, 0, 0);
    const end = new Date(start);
    end.setHours(10, 30, 0, 0);
    const res = await request('POST', path, null, {
      start: start.toISOString(),
      end: end.toISOString(),
      title: 'E2E Test Appointment',
      attendeeEmail: 'test@example.com'
    });
    if (res.status !== 200 && res.status !== 201) {
      report.failed.push({ test: 'POST book appointment', error: `status ${res.status}`, body: res.body });
    } else {
      const d = res.body?.data || res.body;
      const hasShape = d && typeof d.success !== 'undefined';
      if (!hasShape) report.failed.push({ test: 'POST book appointment', error: 'Response not BookAppointmentViewModel', body: d });
      else report.passed.push(`POST book appointment: ${res.status}, success=${d.success} (may be false if no calendar)`);
    }
  } catch (e) {
    report.failed.push({ test: 'POST book appointment', error: e.message });
  }

  // 3) DELETE cancel – requires eventId; we skip if no event created or 400 is ok
  try {
    const path = pathBase + '/appointments/test-event-id-123';
    const res = await request('DELETE', path);
    if (res.status !== 200) {
      report.failed.push({ test: 'DELETE cancel appointment', error: `status ${res.status}`, body: res.body });
    } else {
      const d = res.body?.data || res.body;
      const hasShape = d && typeof d.success !== 'undefined';
      if (!hasShape) report.failed.push({ test: 'DELETE cancel', error: 'Response not CancelAppointmentViewModel', body: d });
      else report.passed.push('DELETE cancel: 200, CommonViewModel');
    }
  } catch (e) {
    report.failed.push({ test: 'DELETE cancel appointment', error: e.message });
  }

  return report;
}

run()
  .then((report) => {
    console.log('\n--- Calendar E2E Report ---\n');
    console.log('Passed:', report.passed.length);
    report.passed.forEach((p) => console.log('  ✓', p));
  console.log('\nFailed:', report.failed.length);
  report.failed.forEach((f) => console.log('  ✗', f.test, f.error, f.code || '', f.note || '', f.body ? JSON.stringify(f.body).slice(0, 200) : ''));
    console.log('\nWarnings:', report.warnings.length);
    report.warnings.forEach((w) => console.log('  •', w));
    console.log('\n---\n');
    process.exit(report.failed.length > 0 ? 1 : 0);
  })
  .catch((err) => {
    console.error('E2E script error:', err);
    process.exit(1);
  });
