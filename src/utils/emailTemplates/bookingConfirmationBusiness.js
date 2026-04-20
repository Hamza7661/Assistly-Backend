'use strict';

function buildBusinessNotificationHtml(params, helpers) {
  const {
    businessName,
    customerName,
    customerEmail,
    customerPhone,
    serviceName,
    startText,
    endText,
    calendarLink,
    theme,
  } = params;
  const { businessNotificationTheme, platformBusinessHeader, formatDateTimeRange, divider, button, wrapEmail } = helpers;

  const brandTheme = businessNotificationTheme(theme);
  const header = platformBusinessHeader(brandTheme.notifyIcon);
  const dateTimeText = formatDateTimeRange(startText, endText);

  const body = `
    <div style="padding:28px 28px 8px;font-family:${brandTheme.bodyFontFamily};color:#1f2937;line-height:1.6;">
      <p style="font-size:15px;">Hi <strong>${businessName}</strong>,</p>
      <p>A new appointment has been booked through your UpZilo assistant.</p>
      ${divider(brandTheme)}
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
      ${divider(brandTheme)}
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
      ${divider(brandTheme)}
      ${calendarLink ? `<p style="margin:16px 0;">${button(calendarLink, 'Open in Calendar', brandTheme)}</p>` : ''}
    </div>`;

  return wrapEmail(header, body, brandTheme);
}

module.exports = {
  buildBusinessNotificationHtml,
};
