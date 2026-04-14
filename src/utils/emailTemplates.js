'use strict';

const fs = require('fs');
const path = require('path');
const { logger } = require('./logger');

/**
 * Absolute URL for static assets on the web app (logos). Set FRONTEND_URL in the API .env
 * (e.g. https://app.example.com) so confirmation emails can load images.
 */
function resolveFrontendAssetUrl(assetPath) {
  if (!assetPath) return '';
  if (/^https?:\/\//i.test(assetPath)) return assetPath;
  const base = (process.env.FRONTEND_URL || process.env.CLIENT_APP_URL || '').replace(/\/$/, '');
  if (!base) return '';
  return `${base}${assetPath.startsWith('/') ? assetPath : `/${assetPath}`}`;
}

/**
 * Brand theme registry — auto-discovered from src/config/brand-themes/.
 *
 * ── Filename conventions ─────────────────────────────────────────────────────
 *
 *  NEW (preferred, collision-proof):
 *    <normalised-name>-<mongoAppId>.js
 *    e.g.  tuitioncenter-507f1f77bcf86cd799439011.js
 *          cribsestates-68b1c2d3e4f567890a123456.js
 *
 *    The 24-char hex suffix is the MongoDB App _id.
 *    This file is indexed by appId — guaranteed unique, no name collisions.
 *
 *  LEGACY (name-only, backward compat):
 *    <normalised-name>.js
 *    e.g.  facelism.js
 *
 *    Indexed by normalised name only; fine when company names are unique.
 *
 * ── Adding a new brand ───────────────────────────────────────────────────────
 *   1. Create  src/config/brand-themes/<name>-<appId>.js
 *   2. Export design tokens (see existing files for reference).
 *   3. Restart the server — no other file changes needed.
 *
 * Brands without a theme file still get a clean branded email driven entirely
 * by their Integration record (primaryColor + chatbot logo) in the database.
 */
const BRAND_THEMES_DIR = path.resolve(__dirname, '../config/brand-themes');

// MongoDB ObjectId = exactly 24 lowercase hex characters
const OBJECT_ID_RE = /^[a-f0-9]{24}$/;

// Two lookup maps built once at startup
const _themesByAppId = {};   // { appId   : theme }  — collision-proof
const _themesByName  = {};   // { normName: theme }  — legacy / convenience

function _loadBrandThemes() {
  try {
    const files = fs.readdirSync(BRAND_THEMES_DIR).filter((f) => f.endsWith('.js'));
    for (const file of files) {
      const stem = file.replace(/\.js$/, '');
      let theme;
      try {
        theme = require(path.join(BRAND_THEMES_DIR, file));
      } catch (err) {
        logger.error(`Failed to load brand theme "${file}":`, { error: err.message });
        continue;
      }

      // Split on the last '-' to try to extract an appId suffix
      const lastDash = stem.lastIndexOf('-');
      const maybeSuffix = lastDash !== -1 ? stem.slice(lastDash + 1).toLowerCase() : '';
      const maybeName   = lastDash !== -1 ? stem.slice(0, lastDash).toLowerCase().replace(/[^a-z0-9]/g, '') : '';

      if (OBJECT_ID_RE.test(maybeSuffix) && maybeName) {
        // New format: name-appId.js
        _themesByAppId[maybeSuffix] = theme;
        _themesByName[maybeName]    = theme; // also index by name for convenience
      } else {
        // Legacy format: name.js
        _themesByName[stem.toLowerCase().replace(/[^a-z0-9]/g, '')] = theme;
      }
    }
    logger.info(
      `Brand themes loaded — by appId: [${Object.keys(_themesByAppId).join(', ') || 'none'}]` +
      ` | by name: [${Object.keys(_themesByName).join(', ') || 'none'}]`
    );
  } catch (err) {
    logger.warn('Brand themes directory not found or unreadable — using default theme only.', {
      dir: BRAND_THEMES_DIR,
      error: err.message,
    });
  }
}

_loadBrandThemes();

const DEFAULT_THEME = {
  primaryColor: '#c01721',
  accentColor: '#e53e3e',
  headerGradient: null,
  headerTextColor: '#ffffff',
  fontFamily: "'Arial', 'Helvetica', sans-serif",
  bodyFontFamily: "'Arial', 'Helvetica', sans-serif",
  borderRadius: '12px',
  logoMode: 'image',
  logoTextStyle: 'font-size:18px;font-weight:700;letter-spacing:0.05em;',
  tagline: '',
  footerBg: '#111827',
  footerTextColor: '#9ca3af',
  buttonColor: '#c01721',
  buttonTextColor: '#ffffff',
  dividerColor: '#e5e7eb',
  confirmIcon: '✅',
  notifyIcon: '📬',
};

/**
 * Resolve a fully-merged email theme for a brand.
 *
 * Lookup order (first match wins):
 *   1. appId   — exact match in _themesByAppId  (collision-proof, preferred)
 *   2. name    — normalised companyName match in _themesByName  (legacy / convenience)
 *   3. DEFAULT_THEME + DB overrides only  (no custom file; clean branded email from DB)
 *
 * @param {string} companyName
 * @param {{ appId?: string, primaryColor?: string, logoUrl?: string }} overrides
 */
function getCompanyTheme(companyName, overrides = {}) {
  const { appId } = overrides;
  const nameKey = (companyName || '').toLowerCase().replace(/[^a-z0-9]/g, '');

  const base =
    (appId && _themesByAppId[String(appId).trim()]) ||
    _themesByName[nameKey] ||
    {};

  let logoUrl = '';
  if (base.emailLogoPath) {
    logoUrl = resolveFrontendAssetUrl(base.emailLogoPath);
    if (!logoUrl) {
      logger.warn(
        `${companyName} email logo URL is empty — set FRONTEND_URL in the API .env to your live web app origin (e.g. https://app.example.com) so ${base.emailLogoPath} can load in emails.`
      );
    }
  } else if (base.logoMode === 'text') {
    logoUrl = '';
  } else {
    logoUrl = overrides.logoUrl || '';
  }

  return {
    ...DEFAULT_THEME,
    ...base,
    primaryColor: overrides.primaryColor || base.primaryColor || DEFAULT_THEME.primaryColor,
    headerGradient:
      base.headerGradient ||
      `linear-gradient(135deg, ${overrides.primaryColor || DEFAULT_THEME.primaryColor} 0%, ${overrides.primaryColor || DEFAULT_THEME.primaryColor}cc 100%)`,
    logoUrl,
    companyName: companyName || 'Our Team',
  };
}

function _logoHtml(theme, { forLightHeader = false } = {}) {
  if (theme.logoUrl) {
    const h = theme.logoHeightPx || 44;
    const center = forLightHeader ? 'margin-left:auto;margin-right:auto;' : '';
    return `<img src="${theme.logoUrl}" alt="${theme.companyName}" style="height:${h}px;max-width:280px;object-fit:contain;display:block;${center}margin-bottom:12px;" />`;
  }
  if (theme.logoMode === 'text') {
    const color = forLightHeader
      ? theme.customerEmailHeaderTitleColor || '#111827'
      : theme.headerTextColor;
    return `<span style="${theme.logoTextStyle};color:${color};">${(theme.companyName || '').toUpperCase()}</span>`;
  }
  return `<span style="font-size:20px;font-weight:700;color:${forLightHeader ? '#111827' : theme.headerTextColor};">${theme.companyName}</span>`;
}

function _customerConfirmationHeader(theme) {
  const useLight = !!theme.customerEmailHeaderBg;
  const bg = useLight ? theme.customerEmailHeaderBg : theme.headerGradient;
  const titleColor = useLight
    ? theme.customerEmailHeaderTitleColor || theme.headerTextColor
    : theme.headerTextColor;
  const taglineColor = useLight
    ? theme.customerEmailHeaderTaglineColor || titleColor
    : theme.headerTextColor;
  const taglineStyle = useLight
    ? `color:${taglineColor};margin:0;font-size:13px;letter-spacing:0.1em;`
    : `color:${taglineColor};opacity:0.85;margin:0;font-size:13px;letter-spacing:0.1em;`;
  const border =
    useLight && theme.customerEmailHeaderBorderBottom
      ? `border-bottom:${theme.customerEmailHeaderBorderBottom};`
      : '';

  return `
    <div style="background:${bg};padding:28px 24px;text-align:center;${border}">
      ${_logoHtml(theme, { forLightHeader: useLight })}
      <h1 style="color:${titleColor};margin:14px 0 4px;font-family:${theme.fontFamily};font-size:22px;font-weight:700;letter-spacing:0.05em;">
        ${theme.confirmIcon} Appointment Confirmed
      </h1>
      ${theme.tagline ? `<p style="${taglineStyle}">${theme.tagline}</p>` : ''}
    </div>`;
}

/** Official UpZilo mark for business booking alerts (hotlink or override via UPZILO_EMAIL_LOGO_URL). */
const UPZILO_BUSINESS_EMAIL_LOGO_DEFAULT =
  'https://upzilo.com/wp-content/uploads/2025/07/UpZilo_Logo-scaled.png';

function _platformBusinessHeader(notifyIcon) {
  const platformName = process.env.FROM_NAME || 'UpZilo';
  const logoUrl =
    (process.env.UPZILO_EMAIL_LOGO_URL && String(process.env.UPZILO_EMAIL_LOGO_URL).trim()) ||
    UPZILO_BUSINESS_EMAIL_LOGO_DEFAULT;
  const logoHtml = `<img src="${logoUrl}" alt="${platformName}" style="height:48px;max-width:260px;width:auto;object-fit:contain;display:block;margin-bottom:14px;" />`;
  const headerBg =
    process.env.UPZILO_BUSINESS_EMAIL_HEADER_BG ||
    'linear-gradient(180deg, #fff5f5 0%, #ffe4e6 45%, #fecdd3 100%)';
  return `
    <div style="background:${headerBg};padding:26px 24px;text-align:left;border-bottom:1px solid #fda4af;">
      ${logoHtml}
      <h1 style="color:#7f1d1d;margin:10px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:20px;font-weight:700;">
        ${notifyIcon} New Appointment Booked
      </h1>
      <p style="color:#57534e;margin:8px 0 0;font-size:12px;line-height:1.55;">
        A client booked through your UpZilo assistant. Details below.
      </p>
    </div>`;
}

function _businessNotificationTheme(baseTheme = {}) {
  return {
    ...baseTheme,
    // Keep body readable and consistent for business alerts.
    bodyFontFamily: "'Arial', 'Helvetica', sans-serif",
    // Match UpZilo header: primary red accents (overridable via UPZILO_BUSINESS_EMAIL_*).
    primaryColor: process.env.UPZILO_BUSINESS_EMAIL_PRIMARY || '#a30d13',
    buttonColor: process.env.UPZILO_BUSINESS_EMAIL_BUTTON || '#c01721',
    buttonTextColor: '#ffffff',
    dividerColor: process.env.UPZILO_BUSINESS_EMAIL_DIVIDER || '#fda4af',
    // Force neutral/brand footer (do not inherit company tagline/footer styling).
    tagline: '',
    footerBg:
      process.env.UPZILO_BUSINESS_EMAIL_FOOTER_BG ||
      'linear-gradient(180deg, #fff5f5 0%, #ffe4e6 100%)',
    footerTextColor: process.env.UPZILO_BUSINESS_EMAIL_FOOTER_TEXT || '#57534e',
    footerLinkColor: process.env.UPZILO_BUSINESS_EMAIL_FOOTER_LINK || '#c01721',
    notifyIcon: '📋',
  };
}

function _button(href, label, theme) {
  return `<a href="${href}" style="display:inline-block;padding:12px 28px;background:${theme.buttonColor};color:${theme.buttonTextColor};text-decoration:none;border-radius:4px;font-weight:600;font-size:14px;letter-spacing:0.05em;">${label}</a>`;
}

function _divider(theme) {
  return `<hr style="border:none;border-top:1px solid ${theme.dividerColor};margin:20px 0;" />`;
}

function _formatDateTimeRange(startText, endText) {
  const start = String(startText || '').trim();
  const end = String(endText || '').trim();
  if (!start && !end) return '';
  if (!end) return start;
  if (!start) return end;

  // If both parse and are same calendar day, keep date once and show end time only.
  const startDate = new Date(start);
  const endDate = new Date(end);
  if (!isNaN(startDate.getTime()) && !isNaN(endDate.getTime())) {
    if (startDate.toDateString() === endDate.toDateString()) {
      const endTime = end.match(/(\d{1,2}:\d{2}\s*[AP]M)$/i)?.[1];
      if (endTime) {
        return `${start} – ${endTime.toUpperCase().replace(/\s+/g, ' ')}`;
      }
    }
  }

  // Fallback for plain text ranges: if date prefix up to year matches, trim date from end.
  const prefixPattern = /^(.+?\b\d{4},?\s*)(.+)$/;
  const s = start.match(prefixPattern);
  const e = end.match(prefixPattern);
  if (s && e && s[1].trim().toLowerCase() === e[1].trim().toLowerCase()) {
    return `${start} – ${e[2].trim()}`;
  }

  return `${start} – ${end}`;
}

function _footer(theme, platformName) {
  const platform = platformName || process.env.FROM_NAME || 'UpZilo';
  const upziloLink = 'https://upzilo.com';
  const linkColor = theme.footerLinkColor || theme.footerTextColor;
  return `
    <div style="background:${theme.footerBg};padding:18px 24px;text-align:center;border-top:1px solid ${theme.footerBorderColor || '#fecdd3'};">
      ${theme.tagline ? `<p style="color:${theme.footerTextColor};font-size:12px;letter-spacing:0.15em;margin:0 0 6px;text-transform:uppercase;">${theme.tagline}</p>` : ''}
      <p style="color:${theme.footerTextColor};font-size:11px;margin:0;">
        Powered by&nbsp;<a href="${upziloLink}" target="_blank" style="color:${linkColor};font-weight:700;text-decoration:none;letter-spacing:0.04em;">${platform}</a>&nbsp;|&nbsp; This is an automated message, please do not reply.
      </p>
    </div>`;
}

/**
 * Build HTML for appointment confirmation sent TO the customer.
 */
function buildCustomerConfirmationHtml({
  customerName,
  serviceName,
  startText,
  endText,
  calendarLink,
  postBookingNote,
  contactPhone,
  theme,
}) {
  const header = _customerConfirmationHeader(theme);
  const dateTimeText = _formatDateTimeRange(startText, endText);
  const contactLine = contactPhone
    ? `If you need to reschedule or have any questions, please contact us directly at <strong>${contactPhone}</strong>.`
    : 'If you need to reschedule or have any questions, please contact us directly.';

  const body = `
    <div style="padding:28px 28px 8px;font-family:${theme.bodyFontFamily};color:#1f2937;line-height:1.6;">
      <p style="font-size:16px;">Hi <strong>${customerName}</strong>,</p>
      <p>Your appointment with <strong>${theme.companyName}</strong> has been confirmed. We look forward to seeing you!</p>
      ${_divider(theme)}
      <table style="width:100%;border-collapse:collapse;">
        <tr>
          <td style="padding:8px 0;color:#6b7280;font-size:13px;width:130px;">Service</td>
          <td style="padding:8px 0;font-weight:600;font-size:14px;color:#111827;">${serviceName}</td>
        </tr>
        <tr>
          <td style="padding:8px 0;color:#6b7280;font-size:13px;">Date &amp; Time</td>
          <td style="padding:8px 0;font-weight:600;font-size:14px;color:#111827;">${dateTimeText}</td>
        </tr>
      </table>
      ${_divider(theme)}
      ${calendarLink ? `<p style="text-align:center;margin:20px 0;">${_button(calendarLink, 'View in Calendar', theme)}</p>` : ''}
      ${postBookingNote ? `
      <div style="background:#faf9f7;border-left:3px solid ${theme.primaryColor};padding:12px 16px;margin:16px 0;border-radius:0 4px 4px 0;">
        <p style="margin:0 0 4px;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:${theme.primaryColor};">Important Instructions</p>
        <div style="margin:0;font-size:13px;color:#374151;line-height:1.6;">${postBookingNote}</div>
      </div>` : ''}
      <p style="margin-top:24px;font-size:14px;">${contactLine}</p>
      <p style="margin-top:20px;font-size:14px;">
        Warm regards,<br/>
        <strong style="font-family:${theme.fontFamily};color:${theme.primaryColor};">${theme.companyName}</strong>
      </p>
    </div>`;

  return _wrapEmail(header, body, theme);
}

/**
 * Build HTML for new appointment notification sent TO the business (UpZilo-branded header).
 */
function buildBusinessNotificationHtml({
  businessName,
  customerName,
  customerEmail,
  customerPhone,
  serviceName,
  startText,
  endText,
  calendarLink,
  theme,
}) {
  const brandTheme = _businessNotificationTheme(theme);
  const header = _platformBusinessHeader(brandTheme.notifyIcon);
  const dateTimeText = _formatDateTimeRange(startText, endText);

  const body = `
    <div style="padding:28px 28px 8px;font-family:${brandTheme.bodyFontFamily};color:#1f2937;line-height:1.6;">
      <p style="font-size:15px;">Hi <strong>${businessName}</strong>,</p>
      <p>A new appointment has been booked through your UpZilo assistant.</p>
      ${_divider(brandTheme)}
      <p style="font-size:13px;font-weight:700;color:${brandTheme.primaryColor};text-transform:uppercase;letter-spacing:0.08em;margin-bottom:8px;">Appointment Details</p>
      <table style="width:100%;border-collapse:collapse;">
        <tr>
          <td style="padding:8px 0;color:#6b7280;font-size:13px;width:130px;">Service</td>
          <td style="padding:8px 0;font-weight:600;font-size:14px;color:#111827;">${serviceName}</td>
        </tr>
        <tr>
          <td style="padding:8px 0;color:#6b7280;font-size:13px;">Date &amp; Time</td>
          <td style="padding:8px 0;font-weight:600;font-size:14px;color:#111827;">${dateTimeText}</td>
        </tr>
      </table>
      ${_divider(brandTheme)}
      <p style="font-size:13px;font-weight:700;color:${brandTheme.primaryColor};text-transform:uppercase;letter-spacing:0.08em;margin-bottom:8px;">Customer Details</p>
      <table style="width:100%;border-collapse:collapse;">
        <tr>
          <td style="padding:8px 0;color:#6b7280;font-size:13px;width:130px;">Name</td>
          <td style="padding:8px 0;font-weight:600;font-size:14px;color:#111827;">${customerName}</td>
        </tr>
        <tr>
          <td style="padding:8px 0;color:#6b7280;font-size:13px;">Email</td>
          <td style="padding:8px 0;font-size:14px;color:#111827;">${customerEmail}</td>
        </tr>
        <tr>
          <td style="padding:8px 0;color:#6b7280;font-size:13px;">Phone</td>
          <td style="padding:8px 0;font-size:14px;color:#111827;">${customerPhone}</td>
        </tr>
      </table>
      ${_divider(brandTheme)}
      ${calendarLink ? `<p style="margin:16px 0;">${_button(calendarLink, 'Open in Calendar', brandTheme)}</p>` : ''}
    </div>`;

  return _wrapEmail(header, body, brandTheme);
}

/**
 * Build HTML for a branded OTP / verification-code email.
 *
 * This is the single builder for every brand — no per-brand copy needed.
 * Visual identity (colors, logo, fonts, footer) comes entirely from `theme`,
 * which is produced by getCompanyTheme() using live DB values (primaryColor,
 * logoUrl, companyName) merged with any COMPANY_THEMES design overrides.
 *
 * To add a new brand: configure their Integration record in the DB.
 * For deep custom styling (fonts, gradient headers, etc.) add an entry to COMPANY_THEMES.
 *
 * @param {{ customerName?: string, otp?: string, supportEmail?: string, theme: Object }} params
 */
function buildBrandedOtpHtml({
  customerName = 'Customer',
  otp = '{{OTP}}',
  supportEmail = '',
  theme,
} = {}) {
  const resolvedTheme = theme || getCompanyTheme('');
  const logoBlock = _logoHtml(resolvedTheme, { forLightHeader: true });
  const borderBottom =
    resolvedTheme.customerEmailHeaderBorderBottom ||
    `3px solid ${resolvedTheme.primaryColor}`;

  const header = `
    <div style="background:${resolvedTheme.customerEmailHeaderBg || '#ffffff'};padding:24px 24px 18px;text-align:center;border-bottom:${borderBottom};">
      ${logoBlock}
      ${resolvedTheme.tagline ? `<p style="margin:6px 0 0;color:${resolvedTheme.customerEmailHeaderTaglineColor || '#6b7280'};font-size:13px;letter-spacing:0.1em;text-transform:uppercase;">${resolvedTheme.tagline}</p>` : ''}
    </div>`;

  const supportLine = supportEmail
    ? `<p style="margin:18px 0 6px;text-align:center;font-size:12px;color:#6b7280;">
        Need help? Contact us at <a href="mailto:${supportEmail}" style="color:${resolvedTheme.primaryColor};text-decoration:none;">${supportEmail}</a>
       </p>`
    : '';

  const body = `
    <div style="padding:28px 28px 8px;font-family:${resolvedTheme.bodyFontFamily};color:#1f2937;line-height:1.6;">
      <h1 style="text-align:center;margin:0 0 16px;font-family:${resolvedTheme.fontFamily};font-size:30px;color:#111827;">Verify Your Identity</h1>
      <p style="text-align:center;color:#4b5563;font-size:16px;margin:0 0 22px;">
        Hello ${customerName},<br/>
        Please use the verification code below to confirm your details with <strong>${resolvedTheme.companyName}</strong>.
      </p>
      <div style="text-align:center;margin:14px 0 18px;">
        <p style="margin:0 0 10px;font-size:12px;text-transform:uppercase;letter-spacing:0.12em;color:#6b7280;">Verification Code</p>
        <div style="display:inline-block;background:#f3f4f6;border:2px solid ${resolvedTheme.primaryColor};color:${resolvedTheme.primaryColor};font-size:34px;font-weight:700;letter-spacing:10px;font-family:'Courier New',monospace;padding:14px 24px;border-radius:${resolvedTheme.borderRadius};">
          ${otp}
        </div>
      </div>
      <div style="margin:20px auto 0;max-width:520px;background:#f9f9f9;border:1px solid ${resolvedTheme.dividerColor};padding:12px 14px;border-radius:4px;text-align:center;">
        <span style="color:${resolvedTheme.primaryColor};font-size:14px;font-weight:600;">This code will expire in 10 minutes</span>
      </div>
      <div style="margin:18px auto 0;max-width:520px;background:#fafafa;border-left:3px solid ${resolvedTheme.primaryColor};padding:12px 14px;border-radius:0 4px 4px 0;">
        <p style="margin:0 0 8px;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:${resolvedTheme.primaryColor};">Important Security Information</p>
        <p style="margin:0;color:#374151;font-size:13px;line-height:1.7;">
          • Never share this code with anyone<br/>
          • Our team will never ask for your verification code<br/>
          • If you did not request this code, please ignore this email
        </p>
      </div>
      ${supportLine}
    </div>`;

  return _wrapEmail(header, body, resolvedTheme);
}

function _wrapEmail(header, body, theme) {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>Appointment</title></head>
<body style="margin:0;padding:0;background:#f3f4f6;">
  <div style="max-width:640px;margin:32px auto;background:#ffffff;border-radius:${theme.borderRadius};overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.10);">
    ${header}
    ${body}
    ${_footer(theme)}
  </div>
</body>
</html>`;
}

module.exports = {
  getCompanyTheme,
  buildBrandedOtpHtml,
  buildCustomerConfirmationHtml,
  buildBusinessNotificationHtml,
  resolveFrontendAssetUrl,
};
