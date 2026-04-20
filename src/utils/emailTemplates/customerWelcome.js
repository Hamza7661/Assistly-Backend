'use strict';

function buildCustomerWelcomeHtml(params, helpers) {
  const { customerName, dashboardUrl, supportEmail, theme } = params;
  const { logoHtml, divider, button, wrapEmail } = helpers;

  const safeDashboardUrl = String(dashboardUrl || '').trim();
  const safeSupportEmail = String(supportEmail || '').trim();
  const header = `
    <div style="background:${theme.customerEmailHeaderBg || '#ffffff'};padding:28px 24px;text-align:center;border-bottom:${theme.customerEmailHeaderBorderBottom || `3px solid ${theme.primaryColor}`};">
      ${logoHtml(theme, { forLightHeader: true })}
      <h1 style="color:${theme.customerEmailHeaderTitleColor || '#111827'};margin:14px 0 4px;font-family:${theme.fontFamily};font-size:22px;font-weight:700;letter-spacing:0.02em;">
        ${theme.confirmIcon || '🎉'} Welcome to ${theme.companyName}
      </h1>
      ${theme.tagline ? `<p style="color:${theme.customerEmailHeaderTaglineColor || '#6b7280'};margin:0;font-size:13px;letter-spacing:0.1em;">${theme.tagline}</p>` : ''}
    </div>`;

  const body = `
    <div style="padding:28px 28px 8px;font-family:${theme.bodyFontFamily};color:#1f2937;line-height:1.6;">
      <p style="font-size:16px;">Hi <strong>${customerName || 'Customer'}</strong>,</p>
      <p>Your account setup is complete and your business assistant is ready to use.</p>
      <p>You can now access your dashboard, configure channels, and start tracking leads and conversations.</p>
      ${divider(theme)}
      ${safeDashboardUrl ? `<p style="text-align:center;margin:20px 0;">${button(safeDashboardUrl, 'Go To Dashboard', theme)}</p>` : ''}
      ${safeSupportEmail ? `<p style="margin-top:16px;font-size:13px;color:#6b7280;text-align:center;">Need help? Contact <a href="mailto:${safeSupportEmail}" style="color:${theme.primaryColor};text-decoration:none;">${safeSupportEmail}</a></p>` : ''}
      <p style="margin-top:18px;font-size:14px;">We are excited to have you with us.</p>
    </div>`;

  return wrapEmail(header, body, theme);
}

module.exports = {
  buildCustomerWelcomeHtml,
};
