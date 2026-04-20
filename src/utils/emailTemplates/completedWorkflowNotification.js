'use strict';

function buildCompletedWorkflowNotificationHtml(params, helpers) {
  const {
    businessName,
    leadType,
    sourceChannel,
    status,
    customerName,
    customerEmail,
    customerPhone,
    serviceType,
    initialInteraction,
    summary,
    description,
    conversationHistory,
    completedAtText,
    viewLeadUrl,
    theme,
  } = params;
  const { businessNotificationTheme, platformBusinessHeader, divider, button, escapeHtml, wrapEmail } = helpers;

  const brandTheme = businessNotificationTheme(theme);
  const header = platformBusinessHeader(brandTheme.notifyIcon);
  const transcriptHtml = Array.isArray(conversationHistory) && conversationHistory.length > 0
    ? conversationHistory.map((turn) => {
      const role = String(turn?.role || 'assistant').trim().toLowerCase() === 'user' ? 'Visitor' : 'Assistant';
      const content = escapeHtml(String(turn?.content || '').trim() || '(empty)');
      return `
        <div style="padding:12px 14px;border:1px solid #e5e7eb;border-radius:10px;background:${role === 'Visitor' ? '#fffaf5' : '#f9fafb'};">
          <p style="margin:0 0 6px;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:${brandTheme.primaryColor};">${role}</p>
          <div style="margin:0;font-size:14px;color:#111827;white-space:pre-wrap;line-height:1.6;">${content}</div>
        </div>`;
    }).join('<div style="height:10px;"></div>')
    : '<p style="margin:0;font-size:14px;color:#6b7280;">No transcript available.</p>';

  const body = `
    <div style="padding:28px 28px 8px;font-family:${brandTheme.bodyFontFamily};color:#1f2937;line-height:1.6;">
      <p style="font-size:15px;">Hi <strong>${businessName}</strong>,</p>
      <p>A visitor has completed your chatbot workflow. The full conversation and captured details are ready for review.</p>
      ${divider(brandTheme)}
      <p style="font-size:13px;font-weight:700;color:${brandTheme.primaryColor};text-transform:uppercase;letter-spacing:0.08em;margin-bottom:8px;">Completion Overview</p>
      <table style="width:100%;border-collapse:collapse;">
        <tr><td style="padding:8px 0;color:#6b7280;font-size:13px;width:130px;">Lead Type</td><td style="padding:8px 0;font-weight:600;font-size:14px;color:#111827;">${leadType}</td></tr>
        <tr><td style="padding:8px 0;color:#6b7280;font-size:13px;">Status</td><td style="padding:8px 0;font-size:14px;color:#111827;">${status}</td></tr>
        <tr><td style="padding:8px 0;color:#6b7280;font-size:13px;">Channel</td><td style="padding:8px 0;font-size:14px;color:#111827;">${sourceChannel}</td></tr>
        <tr><td style="padding:8px 0;color:#6b7280;font-size:13px;">Service</td><td style="padding:8px 0;font-size:14px;color:#111827;">${serviceType}</td></tr>
        <tr><td style="padding:8px 0;color:#6b7280;font-size:13px;">Started With</td><td style="padding:8px 0;font-size:14px;color:#111827;">${initialInteraction}</td></tr>
        <tr><td style="padding:8px 0;color:#6b7280;font-size:13px;">Completed At</td><td style="padding:8px 0;font-size:14px;color:#111827;">${completedAtText}</td></tr>
      </table>
      ${summary ? `<div style="margin:18px 0 0;background:#f9fafb;border-left:3px solid ${brandTheme.primaryColor};padding:12px 14px;border-radius:0 4px 4px 0;"><p style="margin:0 0 4px;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:${brandTheme.primaryColor};">Summary</p><div style="margin:0;font-size:14px;color:#374151;">${escapeHtml(summary)}</div></div>` : ''}
      ${description ? `<div style="margin:12px 0 0;background:#fff;border:1px solid #e5e7eb;padding:12px 14px;border-radius:8px;"><p style="margin:0 0 4px;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:${brandTheme.primaryColor};">Details</p><div style="margin:0;font-size:14px;color:#374151;white-space:pre-wrap;">${escapeHtml(description)}</div></div>` : ''}
      ${divider(brandTheme)}
      <p style="font-size:13px;font-weight:700;color:${brandTheme.primaryColor};text-transform:uppercase;letter-spacing:0.08em;margin-bottom:8px;">Contact Details</p>
      <table style="width:100%;border-collapse:collapse;">
        <tr><td style="padding:8px 0;color:#6b7280;font-size:13px;width:130px;">Name</td><td style="padding:8px 0;font-weight:600;font-size:14px;color:#111827;">${customerName}</td></tr>
        <tr><td style="padding:8px 0;color:#6b7280;font-size:13px;">Email</td><td style="padding:8px 0;font-size:14px;color:#111827;">${customerEmail}</td></tr>
        <tr><td style="padding:8px 0;color:#6b7280;font-size:13px;">Phone</td><td style="padding:8px 0;font-size:14px;color:#111827;">${customerPhone}</td></tr>
      </table>
      ${divider(brandTheme)}
      <p style="font-size:13px;font-weight:700;color:${brandTheme.primaryColor};text-transform:uppercase;letter-spacing:0.08em;margin-bottom:10px;">Conversation History</p>
      <div>${transcriptHtml}</div>
      ${viewLeadUrl ? `<p style="margin:20px 0 6px;">${button(viewLeadUrl, 'View Lead In System', brandTheme)}</p>` : ''}
    </div>`;

  return wrapEmail(header, body, brandTheme);
}

module.exports = {
  buildCompletedWorkflowNotificationHtml,
};
