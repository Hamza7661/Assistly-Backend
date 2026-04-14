'use strict';

/**
 * Cribs Estates brand theme.
 *
 * Auto-loaded from src/config/brand-themes/ by emailTemplates.js.
 *
 * Filename conventions (see emailTemplates.js):
 *   - NEW (preferred): cribsestates-<mongoAppId>.js (24-char hex App _id — collision-proof)
 *   - LEGACY (this file): cribsestates.js — keyed by normalised company name only
 *
 * Lookup order in getCompanyTheme(): appId match first, then normalised companyName
 * (e.g. "Cribs Estates" → "cribsestates"). Used for appointment emails and OTP
 * (buildBrandedOtpHtml) when FRONTEND_URL is set for emailLogoPath assets.
 *
 * Fields:
 *   - emailLogoPath : path relative to FRONTEND_URL (Next.js /public)
 *   - customerEmailHeader* : light header for customer-facing / OTP emails
 *   - Other keys override DEFAULT_THEME in emailTemplates.js
 */
module.exports = {
  primaryColor: '#6b0000',
  accentColor: '#9a0000',
  headerGradient: 'linear-gradient(135deg, #6b0000 0%, #9a0000 60%, #c00000 100%)',
  headerTextColor: '#ffffff',
  fontFamily: "'Arial', 'Helvetica', sans-serif",
  bodyFontFamily: "'Arial', 'Helvetica', sans-serif",
  borderRadius: '0px',
  logoMode: 'image',
  emailLogoPath: '/branding/cribs-estates-logo.png',
  logoHeightPx: 56,
  customerEmailHeaderBg: '#ffffff',
  customerEmailHeaderTitleColor: '#111827',
  customerEmailHeaderTaglineColor: '#6b7280',
  customerEmailHeaderBorderBottom: '3px solid #6b0000',
  logoTextStyle: [
    'display:inline-block',
    'letter-spacing:0.15em',
    'font-size:18px',
    'font-weight:700',
    'color:#ffffff',
    'font-family:Arial,Helvetica,sans-serif',
  ].join(';'),
  tagline: 'Living in London Made Easy',
  footerBg: '#1a0000',
  footerTextColor: '#f5c6c6',
  footerLinkColor: '#ff9999',
  buttonColor: '#6b0000',
  buttonTextColor: '#ffffff',
  dividerColor: '#6b0000',
  confirmIcon: '🏠',
  notifyIcon: '📋',
};
