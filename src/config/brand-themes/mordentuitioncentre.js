'use strict';

/**
 * Morden Tuition Centre brand theme.
 *
 * Keyed by normalized company name:
 *   "Morden Tuition Centre" -> "mordentuitioncentre"
 *
 * Uses a dedicated email logo asset from frontend /public/branding.
 */
module.exports = {
  primaryColor: '#EF662B',
  accentColor: '#EF662B',
  headerTextColor: '#111827',
  fontFamily: "'Arial', 'Helvetica', sans-serif",
  bodyFontFamily: "'Arial', 'Helvetica', sans-serif",
  borderRadius: '12px',
  logoMode: 'image',
  emailLogoPath: '/branding/mordentuitioncentre-logo.png',
  // Use width (not fixed height) because this logo is wide/horizontal.
  logoWidthPx: 250,
  customerEmailHeaderBg: '#ffffff',
  customerEmailHeaderTitleColor: '#111827',
  customerEmailHeaderTaglineColor: '#6b7280',
  customerEmailHeaderBorderBottom: '3px solid #EF662B',
  footerBg: '#0F172A',
  footerTextColor: '#E5E7EB',
  footerLinkColor: '#ffffff',
  buttonColor: '#EF662B',
  buttonTextColor: '#ffffff',
  dividerColor: '#E5E7EB',
};
