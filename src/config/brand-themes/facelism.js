'use strict';

/**
 * Facelism brand theme.
 *
 * Auto-loaded from src/config/brand-themes/ by emailTemplates.js.
 *
 * Filename conventions (see emailTemplates.js):
 *   - NEW (preferred): facelism-<mongoAppId>.js  (24-char hex App _id — collision-proof)
 *   - LEGACY (this file): facelism.js — keyed by normalised company name only
 *
 * Lookup order in getCompanyTheme(): appId match first, then normalised companyName
 * (e.g. "Facelism" → "facelism"). Used for appointment emails and OTP
 * (buildBrandedOtpHtml) when FRONTEND_URL is set for emailLogoPath assets.
 *
 * Fields:
 *   - emailLogoPath : path relative to FRONTEND_URL (Next.js /public)
 *   - customerEmailHeader* : light header for customer-facing / OTP emails
 *   - Other keys override DEFAULT_THEME in emailTemplates.js
 */
module.exports = {
  primaryColor: '#8B7355',
  accentColor: '#C9A96E',
  headerGradient: 'linear-gradient(135deg, #4a3e2e 0%, #7a6448 50%, #C9A96E 100%)',
  headerTextColor: '#ffffff',
  fontFamily: "'Georgia', 'Times New Roman', serif",
  bodyFontFamily: "'Arial', 'Helvetica', sans-serif",
  borderRadius: '0px',
  logoMode: 'image',
  emailLogoPath: '/branding/facelism-logo.png',
  logoHeightPx: 52,
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
};
