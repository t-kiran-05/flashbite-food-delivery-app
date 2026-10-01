// /**
//  * @file src/services/emailService.js
//  * @description Email delivery service for FlashBite using Nodemailer.
//  *              Supports SMTP (Gmail, SendGrid, Amazon SES, Brevo, Resend, or custom SMTP).
//  *              Fails gracefully with terminal links if SMTP is unconfigured.
//  */

// 'use strict';

// const nodemailer = require('nodemailer');

// /**
//  * Builds the nodemailer transport from environment variables.
//  */
// function createTransporter() {
//   const host = process.env.SMTP_HOST;
//   const port = parseInt(process.env.SMTP_PORT || '587', 10);
//   const user = process.env.SMTP_USER || process.env.EMAIL_USER;
//   const pass = process.env.SMTP_PASS || process.env.EMAIL_PASS || process.env.EMAIL_PASSWORD;
//   const secure = process.env.SMTP_SECURE === 'true' || port === 465;

//   // If user provided a Gmail address and no custom host, use Gmail service shortcut
//   if (!host && user && user.includes('@gmail.com')) {
//     return nodemailer.createTransport({
//       service: 'gmail',
//       auth: { user, pass },
//     });
//   }

//   if (host && user && pass) {
//     return nodemailer.createTransport({
//       host,
//       port,
//       secure,
//       auth: { user, pass },
//       tls: {
//         rejectUnauthorized: false,
//       },
//     });
//   }

//   return null;
// }

// /**
//  * Sends a password reset email to the specified user.
//  *
//  * @param {string} toEmail - Recipient email address.
//  * @param {string} resetUrl - Full password reset URL.
//  * @param {string} [userName] - Optional recipient display name.
//  * @returns {Promise<boolean>} True if sent via SMTP, false if fallback logged.
//  */
// async function sendPasswordResetEmail(toEmail, resetUrl, userName = 'there') {
//   const fromAddress = process.env.EMAIL_FROM || process.env.SMTP_USER || process.env.EMAIL_USER || '"FlashBite Support" <no-reply@flashbite.com>';
//   const transporter = createTransporter();

//   console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
//   console.log(`[AUTH] 🔑 PASSWORD RESET REQUEST FOR: ${toEmail}`);
//   console.log(`[AUTH] Reset URL: ${resetUrl}`);
//   console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

//   if (!transporter) {
//     console.warn(
//       '[EMAIL WARN] No SMTP credentials configured in .env (SMTP_USER/SMTP_PASS or EMAIL_USER/EMAIL_PASS).\n' +
//       '             Email was NOT dispatched to the inbox.\n' +
//       '             Use the Reset URL logged above to complete the reset.'
//     );
//     return false;
//   }

//   const htmlContent = `
//     <!DOCTYPE html>
//     <html>
//       <head>
//         <meta charset="utf-8">
//         <style>
//           body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background: #0f172a; color: #f1f5f9; margin: 0; padding: 24px; }
//           .card { max-width: 520px; margin: 0 auto; background: #1e293b; border: 1px solid #334155; border-radius: 16px; padding: 32px; }
//           .logo { font-size: 28px; font-weight: 800; color: #f97316; margin-bottom: 20px; }
//           .title { font-size: 20px; font-weight: 700; color: #f1f5f9; margin-bottom: 12px; }
//           .text { font-size: 14px; color: #94a3b8; line-height: 1.6; margin-bottom: 24px; }
//           .btn { display: inline-block; background: #f97316; color: #ffffff !important; text-decoration: none; font-weight: 700; font-size: 14px; padding: 14px 28px; border-radius: 8px; margin-bottom: 24px; }
//           .footer { font-size: 12px; color: #64748b; border-top: 1px solid #334155; pt: 16px; margin-top: 24px; }
//           .url { word-break: break-all; color: #f97316; }
//         </style>
//       </head>
//       <body>
//         <div class="card">
//           <div class="logo">⚡ FlashBite</div>
//           <div class="title">Reset Your Password</div>
//           <p class="text">
//             Hello ${userName},<br><br>
//             We received a request to reset the password for your FlashBite account. Click the button below to create a new password. This link is valid for <strong>1 hour</strong>.
//           </p>
//           <a href="${resetUrl}" class="btn" target="_blank">Reset Password</a>
//           <p class="text">
//             If you did not request a password reset, you can safely ignore this email. Your password will remain unchanged.
//           </p>
//           <div class="footer">
//             If the button doesn't work, copy and paste this link into your browser:<br>
//             <a href="${resetUrl}" class="url">${resetUrl}</a>
//           </div>
//         </div>
//       </body>
//     </html>
//   `;

//   try {
//     const info = await transporter.sendMail({
//       from: fromAddress,
//       to: toEmail,
//       subject: '⚡ FlashBite Password Reset Request',
//       text: `Hello ${userName},\n\nWe received a request to reset your FlashBite password. Please open the link below to set a new password:\n\n${resetUrl}\n\nThis link is valid for 1 hour.\n\nIf you didn't request this, you can ignore this email.`,
//       html: htmlContent,
//     });

//     console.log(`[EMAIL] ✅ Password reset email dispatched to ${toEmail} (Message ID: ${info.messageId})`);
//     return true;
//   } catch (err) {
//     console.error(`[EMAIL ERROR] Failed to send email via SMTP to ${toEmail}:`, err.message);
//     return false;
//   }
// }

// module.exports = {
//   sendPasswordResetEmail,
// };


/**
 * @file src/services/emailService.js
 * @description Email delivery service for FlashBite using Nodemailer.
 *              Supports Gmail SMTP (App Passwords) and custom SMTP servers.
 *              Fails gracefully with terminal links if credentials are missing.
 */

'use strict';

const nodemailer = require('nodemailer');

/**
 * Strips accidental double/single quotes and leading/trailing whitespace from env variables.
 */
function cleanEnv(value) {
  if (!value) return '';
  return value.replace(/^['"]|['"]$/g, '').trim();
}

/**
 * Builds the Nodemailer transport instance using current environment variables.
 */
function createTransporter() {
  const host = cleanEnv(process.env.SMTP_HOST);
  const port = parseInt(cleanEnv(process.env.SMTP_PORT) || '465', 10);
  const user = cleanEnv(process.env.SMTP_USER || process.env.EMAIL_USER);
  const pass = cleanEnv(process.env.SMTP_PASS || process.env.EMAIL_PASS || process.env.EMAIL_PASSWORD);
  const secure = cleanEnv(process.env.SMTP_SECURE) === 'true' || port === 465;

  // Shortcut for Gmail if host is specifically set to Gmail or omitted with a @gmail.com user
  if (host === 'smtp.gmail.com' || (!host && user && user.includes('@gmail.com'))) {
    return nodemailer.createTransport({
      service: 'gmail',
      auth: { user, pass },
    });
  }

  // Standard generic SMTP connection fallback
  if (host && user && pass) {
    return nodemailer.createTransport({
      host,
      port,
      secure,
      auth: { user, pass },
      tls: {
        rejectUnauthorized: false,
      },
    });
  }

  return null;
}

/**
 * Sends a password reset email to the target recipient.
 *
 * @param {string} toEmail - Recipient email address.
 * @param {string} resetUrl - Complete password reset link with token.
 * @param {string} [userName] - Optional display name of the recipient.
 * @returns {Promise<boolean>} Resolves to true if sent successfully, or false on error/fallback.
 */
async function sendPasswordResetEmail(toEmail, resetUrl, userName = 'there') {
  const rawFrom = cleanEnv(process.env.EMAIL_FROM);
  const fallbackUser = cleanEnv(process.env.SMTP_USER || process.env.EMAIL_USER);

  const fromAddress =
    rawFrom ||
    (fallbackUser ? `"FlashBite Support" <${fallbackUser}>` : '"FlashBite Support" <no-reply@flashbite.com>');

  const transporter = createTransporter();

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`[AUTH] 🔑 PASSWORD RESET REQUEST FOR: ${toEmail}`);
  console.log(`[AUTH] Reset URL: ${resetUrl}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  if (!transporter) {
    console.warn(
      '[EMAIL WARN] No SMTP credentials configured in .env (SMTP_USER/SMTP_PASS or EMAIL_USER/EMAIL_PASS).\n' +
        '             Email was NOT dispatched to the inbox.\n' +
        '             Use the Reset URL logged above to complete the reset.'
    );
    return false;
  }

  const htmlContent = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background: #0f172a; color: #f1f5f9; margin: 0; padding: 24px; }
          .card { max-width: 520px; margin: 0 auto; background: #1e293b; border: 1px solid #334155; border-radius: 16px; padding: 32px; }
          .logo { font-size: 28px; font-weight: 800; color: #f97316; margin-bottom: 20px; }
          .title { font-size: 20px; font-weight: 700; color: #f1f5f9; margin-bottom: 12px; }
          .text { font-size: 14px; color: #94a3b8; line-height: 1.6; margin-bottom: 24px; }
          .btn { display: inline-block; background: #f97316; color: #ffffff !important; text-decoration: none; font-weight: 700; font-size: 14px; padding: 14px 28px; border-radius: 8px; margin-bottom: 24px; }
          .footer { font-size: 12px; color: #64748b; border-top: 1px solid #334155; padding-top: 16px; margin-top: 24px; }
          .url { word-break: break-all; color: #f97316; }
        </style>
      </head>
      <body>
        <div class="card">
          <div class="logo">⚡ FlashBite</div>
          <div class="title">Reset Your Password</div>
          <p class="text">
            Hello ${userName},<br><br>
            We received a request to reset the password for your FlashBite account. Click the button below to create a new password. This link is valid for <strong>1 hour</strong>.
          </p>
          <a href="${resetUrl}" class="btn" target="_blank">Reset Password</a>
          <p class="text">
            If you did not request a password reset, you can safely ignore this email. Your password will remain unchanged.
          </p>
          <div class="footer">
            If the button doesn't work, copy and paste this link into your browser:<br>
            <a href="${resetUrl}" class="url">${resetUrl}</a>
          </div>
        </div>
      </body>
    </html>
  `;

  try {
    const info = await transporter.sendMail({
      from: fromAddress,
      to: toEmail,
      subject: '⚡ FlashBite Password Reset Request',
      text: `Hello ${userName},\n\nWe received a request to reset your FlashBite password. Please open the link below to set a new password:\n\n${resetUrl}\n\nThis link is valid for 1 hour.\n\nIf you didn't request this, you can ignore this email.`,
      html: htmlContent,
    });

    console.log(`[EMAIL] ✅ Password reset email dispatched to ${toEmail} (Message ID: ${info.messageId})`);
    return true;
  } catch (err) {
    console.error(`[EMAIL ERROR] Failed to send email via SMTP to ${toEmail}:`, err.message);
    return false;
  }
}

module.exports = {
  sendPasswordResetEmail,
};