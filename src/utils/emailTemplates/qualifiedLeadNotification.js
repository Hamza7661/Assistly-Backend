'use strict';

function buildQualifiedLeadNotificationHtml(params, helpers) {
  const {
    businessName,
    leadType,
    sourceChannel,
    customerName,
    customerEmail,
    customerPhone,
    initialInteraction,
    clickedItems,
    createdAtText,
    viewLeadUrl,
    theme,
  } = params;
  const { businessNotificationTheme, platformBusinessHeader, divider, button, wrapEmail } = helpers;

  const brandTheme = businessNotificationTheme(theme);
  const header = platformBusinessHeader(brandTheme.notifyIcon);
  const clickedText = Array.isArray(clickedItems) && clickedItems.length > 0
    ? clickedItems.join(', ')
    : 'Not provided';

  const body = `
    <div style="padding:28px 28px 8px;font-family:${brandTheme.bodyFontFamily};color:#1f2937;line-height:1.6;">
      <p style="font-size:15px;">Hi <strong>${businessName}</strong>,</p>
      <p>Your UpZilo assistant has generated a new qualified lead. Their details are ready for review in your dashboard.</p>
      ${divider(brandTheme)}
      <p style="font-size:13px;font-weight:700;color:${brandTheme.primaryColor};text-transform:uppercase;letter-spacing:0.08em;margin-bottom:8px;">Lead Summary</p>
      <table style="width:100%;border-collapse:collapse;">
        <tr>
          <td style="padding:8px 0;color:#6b7280;font-size:13px;width:130px;">Lead Type</td>
          <td style="padding:8px 0;font-weight:600;font-size:14px;color:#111827;">${leadType}</td>
        </tr>
        <tr>
          <td style="padding:8px 0;color:#6b7280;font-size:13px;">Channel</td>
          <td style="padding:8px 0;font-size:14px;color:#111827;">${sourceChannel}</td>
        </tr>
        <tr>
          <td style="padding:8px 0;color:#6b7280;font-size:13px;">Started With</td>
          <td style="padding:8px 0;font-size:14px;color:#111827;">${initialInteraction}</td>
        </tr>
        <tr>
          <td style="padding:8px 0;color:#6b7280;font-size:13px;">Selected Items</td>
          <td style="padding:8px 0;font-size:14px;color:#111827;">${clickedText}</td>
        </tr>
        <tr>
          <td style="padding:8px 0;color:#6b7280;font-size:13px;">Qualified At</td>
          <td style="padding:8px 0;font-size:14px;color:#111827;">${createdAtText}</td>
        </tr>
      </table>
      ${divider(brandTheme)}
      <p style="font-size:13px;font-weight:700;color:${brandTheme.primaryColor};text-transform:uppercase;letter-spacing:0.08em;margin-bottom:8px;">Contact Details</p>
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
      <div style="background:#f9fafb;border:1px solid #e5e7eb;padding:14px 16px;border-radius:10px;margin:18px 0;">
        <p style="margin:0 0 6px;font-size:13px;font-weight:700;color:${brandTheme.primaryColor};">Why this matters</p>
        <p style="margin:0;font-size:14px;color:#374151;">
          Your chatbot has already captured the visitor's intent and personal details, helping your team respond faster with context instead of starting from scratch.
        </p>
      </div>
      ${viewLeadUrl ? `<p style="margin:18px 0 6px;">${button(viewLeadUrl, 'View Lead In System', brandTheme)}</p>` : ''}
    </div>`;

  return wrapEmail(header, body, brandTheme);
}

module.exports = {
  buildQualifiedLeadNotificationHtml,
};
