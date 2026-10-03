/**
 * The sign-in code email, in Zing's colours (app/globals.css).
 *
 * Email clients ignore <style> blocks and modern CSS unevenly, so this is the
 * old-fashioned dialect that renders everywhere: tables for layout, every
 * style inline, bgcolor attributes as a fallback, no web fonts. The logo is
 * attached and referenced by cid, so it shows even where remote images are
 * blocked by default.
 */

export const LOGO_CID = 'zing-logo';

const COLORS = {
  void: '#0b0f10',
  surface: '#151b1d',
  elevated: '#1d2528',
  line: '#253034',
  ink: '#e8edee',
  muted: '#8a9a9d',
  faint: '#5c6b6e',
  zing: '#00cfc1',
} as const;

const FONT = `-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif`;

export function signInCodeText(code: string): string {
  return [
    `Your Zing code is ${code}.`,
    '',
    'Enter it in Zing to continue. It expires in 10 minutes.',
    '',
    'If you did not ask for this code, you can ignore this email. Someone may have typed your address by mistake.',
  ].join('\n');
}

export function signInCodeHtml(code: string): string {
  // Digits only (checked by the caller), but never trust a template input.
  const digits = code.replace(/\D/g, '');
  const c = COLORS;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<meta name="supported-color-schemes" content="dark">
<title>Your Zing code</title>
</head>
<body style="margin:0;padding:0;background-color:${c.void};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${c.void};">Your Zing code is ${digits}. It expires in 10 minutes.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${c.void}" style="background-color:${c.void};">
  <tr>
    <td align="center" style="padding:40px 16px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:440px;">
        <tr>
          <td align="center" style="padding-bottom:24px;">
            <img src="cid:${LOGO_CID}" width="64" height="64" alt="Zing" style="display:block;width:64px;height:64px;border:0;border-radius:16px;">
          </td>
        </tr>
        <tr>
          <td bgcolor="${c.surface}" style="background-color:${c.surface};border:1px solid ${c.line};border-radius:20px;padding:32px 28px;font-family:${FONT};">
            <p style="margin:0 0 8px;font-size:22px;line-height:28px;font-weight:700;color:${c.ink};">Your sign-in code</p>
            <p style="margin:0 0 24px;font-size:15px;line-height:22px;color:${c.muted};">Enter this code in Zing to continue.</p>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td align="center" bgcolor="${c.elevated}" style="background-color:${c.elevated};border:1px solid ${c.zing};border-radius:16px;padding:20px 12px;">
                  <span style="font-family:${FONT};font-size:36px;line-height:40px;font-weight:700;letter-spacing:10px;padding-left:10px;color:${c.zing};">${digits}</span>
                </td>
              </tr>
            </table>
            <p style="margin:24px 0 0;font-size:14px;line-height:21px;color:${c.muted};">This code expires in <span style="color:${c.ink};font-weight:600;">10 minutes</span> and works once.</p>
            <p style="margin:16px 0 0;font-size:13px;line-height:20px;color:${c.faint};">Didn't ask for it? You can ignore this email. Someone may have typed your address by mistake, and nobody can sign in without this code.</p>
          </td>
        </tr>
        <tr>
          <td align="center" style="padding-top:24px;font-family:${FONT};font-size:12px;line-height:18px;color:${c.faint};">
            <span style="color:${c.zing};font-weight:700;">Zing</span> &middot; Fast. Lively. Connected.<br>
            Every message is encrypted on your device.
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}
