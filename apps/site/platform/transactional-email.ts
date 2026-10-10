import { escapeHtml } from '@lasvegasfortransit/platform-integrations/email';

const SITE = 'https://lasvegasfortransit.org';

interface TransactionalEmail {
  heading: string;
  body: string;
  action?: { href: string; label: string };
  note?: string;
}

/** A compact, email-client-safe frame for membership and account messages. */
export function transactionalEmailHtml({
  heading,
  body,
  action,
  note,
}: TransactionalEmail): string {
  const safeHeading = escapeHtml(heading);
  const safeBody = escapeHtml(body);
  const actionHtml = action
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" bgcolor="#0f1115" style="border-collapse:collapse;background-color:#0f1115;mso-table-lspace:0pt;mso-table-rspace:0pt"><tr><td bgcolor="#0f1115" style="padding:15px 20px;background-color:#0f1115"><a href="${escapeHtml(action.href)}" style="color:#f7f4ec;font-size:16px;line-height:125%;font-weight:700;text-decoration:none">${escapeHtml(action.label)}</a></td></tr></table>`
    : '';
  const noteHtml = note
    ? `<p style="margin:28px 0 0;color:#4a4e57;font-size:14px;line-height:155%">${escapeHtml(note)}</p>`
    : '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light"><title>${safeHeading}</title><style type="text/css">@font-face{font-family:'Public Sans';src:url('${SITE}/fonts/public-sans-latin.woff2') format('woff2');font-style:normal;font-weight:100 900;mso-font-alt:Arial}@media only screen and (max-width:640px){.outer{padding:0!important}.email{width:100%!important}.main{padding:36px 24px 40px!important}.footer{padding:26px 24px 30px!important}.headline{font-size:34px!important;line-height:110%!important}}</style><!--[if mso]><style type="text/css">body,table,td,h1,p,a,span{font-family:Arial,Helvetica,sans-serif!important}</style><![endif]--></head><body style="margin:0;padding:0;background-color:#efe9db;color:#0f1115;font-family:'Public Sans',Arial,Helvetica,sans-serif"><table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" bgcolor="#efe9db" style="border-collapse:collapse;background-color:#efe9db;mso-table-lspace:0pt;mso-table-rspace:0pt;font-family:'Public Sans',Arial,Helvetica,sans-serif"><tr><td class="outer" align="center" style="padding:46px 20px 72px"><!--[if mso]><table role="presentation" cellpadding="0" cellspacing="0" border="0" width="620" align="center"><tr><td><![endif]--><table role="presentation" cellpadding="0" cellspacing="0" border="0" class="email" width="100%" bgcolor="#f7f4ec" style="width:100%;max-width:620px;border-collapse:collapse;background-color:#f7f4ec;mso-table-lspace:0pt;mso-table-rspace:0pt;font-family:'Public Sans',Arial,Helvetica,sans-serif"><tr><td height="8" bgcolor="#e5471a" style="height:8px;background-color:#e5471a;font-size:0;line-height:0">&nbsp;</td></tr><tr><td class="main" style="padding:40px 48px 48px"><p style="margin:0 0 34px;color:#0f1115;font-size:18px;line-height:110%;font-weight:800;letter-spacing:-0.6px"><a href="${SITE}/" style="color:#0f1115;text-decoration:none">Las Vegans<br><span style="color:#e5471a">for Better Transit</span></a></p><h1 class="headline" style="margin:0 0 20px;color:#0f1115;font-size:38px;line-height:110%;letter-spacing:-1px;font-weight:800">${safeHeading}</h1><p style="margin:0 0 ${action ? '28' : '0'}px;color:#0f1115;font-size:17px;line-height:155%">${safeBody}</p>${actionHtml}${noteHtml}</td></tr><tr><td class="footer" bgcolor="#0f1115" style="padding:28px 48px 34px;background-color:#0f1115;color:#f7f4ec"><p style="margin:0 0 10px;color:#f7f4ec;font-size:15px;line-height:140%;font-weight:700"><a href="${SITE}/" style="color:#f7f4ec;text-decoration:none">Las Vegans for Better Transit</a></p><p style="margin:0;color:#a8acb4;font-size:13px;line-height:155%">Questions? Reply to this email or write to hello@lasvegasfortransit.org.</p></td></tr></table><!--[if mso]></td></tr></table><![endif]--></td></tr></table></body></html>`;
}
