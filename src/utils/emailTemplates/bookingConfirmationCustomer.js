'use strict';

function buildCustomerConfirmationHtml(params, helpers) {
  const {
    customerName,
    serviceName,
    startText,
    endText,
    calendarLink,
    postBookingNote,
    contactPhone,
    theme,
  } = params;
  const { customerConfirmationHeader, formatDateTimeRange, divider, button, wrapEmail } = helpers;

  const header = customerConfirmationHeader(theme);
  const dateTimeText = formatDateTimeRange(startText, endText);
  const contactLine = contactPhone
    ? `If you need to reschedule or have any questions, please contact us directly at <strong>${contactPhone}</strong>.`
    : 'If you need to reschedule or have any questions, please contact us directly.';

  const body = `
    <div style="padding:28px 28px 8px;font-family:${theme.bodyFontFamily};color:#1f2937;line-height:1.6;">
      <p style="font-size:16px;">Hi <strong>${customerName}</strong>,</p>
      <p>Your appointment with <strong>${theme.companyName}</strong> has been confirmed. We look forward to seeing you!</p>
      ${divider(theme)}
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
      ${divider(theme)}
      ${calendarLink ? `<p style="text-align:center;margin:20px 0;">${button(calendarLink, 'View in Calendar', theme)}</p>` : ''}
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

  return wrapEmail(header, body, theme);
}

module.exports = {
  buildCustomerConfirmationHtml,
};
