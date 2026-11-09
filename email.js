/**
 * Email helper for Spin Next — wraps the Resend SDK.
 * Reuses the same account & API key as the family-tree app (both are on the
 * sweetsmilingsoul.com domain), with Spin Next-specific templates.
 *
 * Env vars:
 *   RESEND_API_KEY   — same value as the family-tree server
 *   EMAIL_FROM       — defaults to "Spin Next <noreply@sweetsmilingsoul.com>"
 *   APP_BASE_URL     — public origin for links (e.g. https://spin.sweetsmilingsoul.com)
 */
const { Resend } = require('resend');

const FROM    = process.env.EMAIL_FROM || 'Spin Next <noreply@sweetsmilingsoul.com>';
const APP_URL = process.env.APP_BASE_URL || 'https://spin.sweetsmilingsoul.com';

let _client = null;
function client() {
  if (!process.env.RESEND_API_KEY) throw new Error('RESEND_API_KEY is not set on the server');
  if (!_client) _client = new Resend(process.env.RESEND_API_KEY);
  return _client;
}
function isConfigured() { return Boolean(process.env.RESEND_API_KEY); }

async function sendEmail({ to, subject, html, text }) {
  const result = await client().emails.send({
    from: FROM,
    to: Array.isArray(to) ? to : [to],
    subject, html,
    text: text || html.replace(/<[^>]+>/g, ''),
  });
  if (result.error) throw new Error('Resend rejected message: ' + JSON.stringify(result.error));
  return result.data;
}

function wrapInLayout(bodyHtml) {
  return `<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:#f4efe6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#2a221a">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4efe6;padding:40px 16px">
    <tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="background:#fff;border:1px solid #e4dccd;border-radius:10px;overflow:hidden;max-width:560px">
        <tr><td style="padding:24px 28px;border-bottom:1px solid #e4dccd;font-size:18px;font-weight:600">
          💿 Spin Next
        </td></tr>
        <tr><td style="padding:28px;font-size:15px;line-height:1.55">${bodyHtml}</td></tr>
        <tr><td style="padding:18px 28px;border-top:1px solid #e4dccd;font-size:12px;color:#8c7b5e">
          Sent from <a href="${APP_URL}" style="color:#3d6fd8">${APP_URL}</a>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

function buttonHtml(href, label) {
  return `<p style="margin:24px 0">
    <a href="${href}" style="display:inline-block;padding:11px 22px;background:#2a221a;color:#fff;text-decoration:none;border-radius:6px;font-weight:600;font-size:14px">${label}</a>
  </p>
  <p style="font-size:12px;color:#8c7b5e">Or paste this link into your browser:<br><a href="${href}" style="color:#3d6fd8;word-break:break-all">${href}</a></p>`;
}

const ROLE_LABELS = { admin: 'Admin', user: 'User' };

async function sendTestEmail(to) {
  return sendEmail({
    to,
    subject: '✅ Spin Next — email is working',
    html: wrapInLayout(`<p>If you're reading this, Spin Next can send email through Resend. 🎉</p>`),
  });
}

async function sendInvitation({ to, inviterName, role, token }) {
  const link = `${APP_URL}/accept-invite.html?token=${encodeURIComponent(token)}`;
  return sendEmail({
    to,
    subject: `${inviterName} invited you to Spin Next`,
    html: wrapInLayout(`
      <p>Hello,</p>
      <p><strong>${inviterName}</strong> has invited you to Spin Next — a shared tracker for the <em>1001 Albums You Must Hear Before You Die</em> list.</p>
      <p>Each listener keeps their own ratings, notes and listening history. Accept your invitation and pick a username + password below:</p>
      ${buttonHtml(link, 'Accept Invitation')}
      <p style="font-size:12px;color:#8c7b5e">This invitation expires in 7 days.</p>
    `),
  });
}

async function sendPasswordReset({ to, username, token }) {
  const link = `${APP_URL}/reset-password.html?token=${encodeURIComponent(token)}`;
  return sendEmail({
    to,
    subject: 'Spin Next — reset your password',
    html: wrapInLayout(`
      <p>Hello ${username || 'there'},</p>
      <p>Someone requested a password reset for your Spin Next account.</p>
      ${buttonHtml(link, 'Reset Password')}
      <p style="font-size:12px;color:#8c7b5e">This link expires in 1 hour. If you didn't request this, ignore this email.</p>
    `),
  });
}

module.exports = { isConfigured, sendEmail, sendTestEmail, sendInvitation, sendPasswordReset, APP_URL };
