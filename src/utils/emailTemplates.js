'use strict';

const { logger } = require('./logger');

/**
 * Absolute URL for static assets on the web app (logos). Set FRONTEND_URL in the API .env
 * (e.g. https://app.example.com) so confirmation emails can load images.
 */
function resolveFrontendAssetUrl(path) {
  if (!path) return '';
  if (/^https?:\/\//i.test(path)) return path;
  const base = (process.env.FRONTEND_URL || process.env.CLIENT_APP_URL || '').replace(/\/$/, '');
  if (!base) return '';
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}

/**
 * Company theme registry.
 * Keys must be lowercase, no spaces (normalized from companyName).
 */
const COMPANY_THEMES = {
  facelism: {
    primaryColor: '#8B7355',
    accentColor: '#C9A96E',
    headerGradient: 'linear-gradient(135deg, #4a3e2e 0%, #7a6448 50%, #C9A96E 100%)',
    headerTextColor: '#ffffff',
    fontFamily: "'Georgia', 'Times New Roman', serif",
    bodyFontFamily: "'Arial', 'Helvetica', sans-serif",
    borderRadius: '0px',
    logoMode: 'image',
    /** Served from the frontend public folder */
    emailLogoPath: '/branding/facelism-logo.png',
    logoHeightPx: 52,
    /** Customer confirmation: real logo is black on white */
    customerEmailHeaderBg: '#ffffff',
    customerEmailHeaderTitleColor: '#111827',
    customerEmailHeaderTaglineColor: '#6b7280',
    customerEmailHeaderBorderBottom: '3px solid #C9A96E',
    logoTextStyle: [
      'display:inline-block',
      'letter-spacing:0.3em',
      'font-size:18px',
      'font-weight:700',
      'border:2px solid rgba(255,255,255,0.8)',
      'padding:6px 14px',
      'font-family:Georgia,serif',
    ].join(';'),
    tagline: 'Where Radiant Skin Begins',
    footerBg: '#2a1f14',
    footerTextColor: '#C9A96E',
    buttonColor: '#8B7355',
    buttonTextColor: '#ffffff',
    dividerColor: '#C9A96E',
    confirmIcon: '✨',
    notifyIcon: '📋',
  },
};

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
 * @param {string} companyName
 * @param {{ primaryColor?: string, logoUrl?: string }} overrides  – live values from DB
 */
function getCompanyTheme(companyName, overrides = {}) {
  const key = (companyName || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const base = COMPANY_THEMES[key] || {};

  let logoUrl = '';
  if (base.emailLogoPath) {
    logoUrl = resolveFrontendAssetUrl(base.emailLogoPath);
    if (!logoUrl && key === 'facelism') {
      logger.warn(
        'Facelism email logo URL is empty — set FRONTEND_URL in the API .env to your live web app origin (e.g. https://app.example.com) so /branding/facelism-logo.png can load in emails.'
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

function _button(href, label, theme) {
  return `<a href="${href}" style="display:inline-block;padding:12px 28px;background:${theme.buttonColor};color:${theme.buttonTextColor};text-decoration:none;border-radius:4px;font-weight:600;font-size:14px;letter-spacing:0.05em;">${label}</a>`;
}

function _divider(theme) {
  return `<hr style="border:none;border-top:1px solid ${theme.dividerColor};margin:20px 0;" />`;
}

function _footer(theme, platformName) {
  const platform = platformName || process.env.FROM_NAME || 'UpZilo';
  const upziloLink = 'https://upzilo.com';
  return `
    <div style="background:${theme.footerBg};padding:18px 24px;text-align:center;">
      ${theme.tagline ? `<p style="color:${theme.footerTextColor};font-size:12px;letter-spacing:0.15em;margin:0 0 6px;text-transform:uppercase;">${theme.tagline}</p>` : ''}
      <p style="color:${theme.footerTextColor};font-size:11px;margin:0;opacity:0.7;">
        Powered by&nbsp;<a href="${upziloLink}" target="_blank" style="color:${theme.footerTextColor};font-weight:700;text-decoration:none;letter-spacing:0.04em;">${platform}</a>&nbsp;|&nbsp; This is an automated message, please do not reply.
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
  theme,
}) {
  const header = _customerConfirmationHeader(theme);

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
          <td style="padding:8px 0;font-weight:600;font-size:14px;color:#111827;">${startText}${endText ? ` – ${endText}` : ''}</td>
        </tr>
      </table>
      ${_divider(theme)}
      ${calendarLink ? `<p style="text-align:center;margin:20px 0;">${_button(calendarLink, 'View in Calendar', theme)}</p>` : ''}
      ${postBookingNote ? `
      <div style="background:#faf9f7;border-left:3px solid ${theme.primaryColor};padding:12px 16px;margin:16px 0;border-radius:0 4px 4px 0;">
        <p style="margin:0 0 4px;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:${theme.primaryColor};">Important Instructions</p>
        <div style="margin:0;font-size:13px;color:#374151;line-height:1.6;">${postBookingNote}</div>
      </div>` : ''}
      <p style="margin-top:24px;font-size:14px;">
        If you need to reschedule or have any questions, please contact us directly.
      </p>
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
  const header = _platformBusinessHeader(theme.notifyIcon);

  const body = `
    <div style="padding:28px 28px 8px;font-family:${theme.bodyFontFamily};color:#1f2937;line-height:1.6;">
      <p style="font-size:15px;">Hi <strong>${businessName}</strong>,</p>
      <p>A new appointment has been booked through your chatbot assistant.</p>
      ${_divider(theme)}
      <p style="font-size:13px;font-weight:700;color:${theme.primaryColor};text-transform:uppercase;letter-spacing:0.08em;margin-bottom:8px;">Appointment Details</p>
      <table style="width:100%;border-collapse:collapse;">
        <tr>
          <td style="padding:8px 0;color:#6b7280;font-size:13px;width:130px;">Service</td>
          <td style="padding:8px 0;font-weight:600;font-size:14px;color:#111827;">${serviceName}</td>
        </tr>
        <tr>
          <td style="padding:8px 0;color:#6b7280;font-size:13px;">Date &amp; Time</td>
          <td style="padding:8px 0;font-weight:600;font-size:14px;color:#111827;">${startText}${endText ? ` – ${endText}` : ''}</td>
        </tr>
      </table>
      ${_divider(theme)}
      <p style="font-size:13px;font-weight:700;color:${theme.primaryColor};text-transform:uppercase;letter-spacing:0.08em;margin-bottom:8px;">Customer Details</p>
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
      ${_divider(theme)}
      ${calendarLink ? `<p style="margin:16px 0;">${_button(calendarLink, 'Open in Calendar', theme)}</p>` : ''}
    </div>`;

  return _wrapEmail(header, body, theme);
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
  buildCustomerConfirmationHtml,
  buildBusinessNotificationHtml,
  resolveFrontendAssetUrl,
};
