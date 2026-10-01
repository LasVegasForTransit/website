import type { Interest } from './core/join-form';
import { escapeHtml } from './integrations/email';
import type { Db } from './storage/db';

const SITE = 'https://lasvegasfortransit.org';

export interface WelcomeAction {
  title: string;
  description: string;
  label: string;
  href: string;
}

export async function featuredWelcomeAction(
  db: Db,
  referral: string | null,
  now = new Date(),
): Promise<WelcomeAction | null> {
  const timestamp = now.toISOString();
  try {
    return await db
      .prepare(
        `SELECT title, description, label, href FROM onboarding_actions
         WHERE active = 1 AND starts_at <= ? AND ends_at > ? AND id != ?
         ORDER BY priority DESC, starts_at DESC LIMIT 1`,
      )
      .bind(timestamp, timestamp, referral ?? '')
      .first<WelcomeAction>();
  } catch {
    console.error('Could not read onboarding actions');
    return null;
  }
}

export function welcomeAction(
  interests: Interest[],
  featured: WelcomeAction | null,
): WelcomeAction {
  if (featured) return featured;
  if (interests.includes('meetings')) {
    return {
      title: 'Speak up for better transit',
      description:
        'Find an upcoming LVBT meeting or action where your voice can make a difference.',
      label: 'See upcoming meetings and events',
      href: `${SITE}/events/`,
    };
  }
  if (interests.includes('events')) {
    return {
      title: 'Come to an LVBT event',
      description: 'Meet other riders and advocates at an upcoming event.',
      label: 'See upcoming events',
      href: `${SITE}/events/`,
    };
  }
  if (interests.includes('volunteering')) {
    return {
      title: 'Find a way to volunteer',
      description: 'See the teams and projects where you can pitch in.',
      label: 'Explore volunteer roles',
      href: `${SITE}/join/#team`,
    };
  }
  return {
    title: 'Get involved with LVBT',
    description: 'Find a way to help that fits your time and interests.',
    label: 'Explore ways to get involved',
    href: `${SITE}/go/`,
  };
}

interface WelcomeEmail {
  givenName: string;
  action: WelcomeAction;
  unsubscribeUrl: string;
}

function communityCard(card: {
  icon: string;
  title: string;
  description: string;
  label: string;
  href: string;
}) {
  const { icon, title, description, label, href } = card;
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" bgcolor="#f7f4ec" style="margin-top:12px;border-collapse:collapse;background-color:#f7f4ec;border:1px solid #0f1115;mso-table-lspace:0pt;mso-table-rspace:0pt"><tr><td width="72" valign="top" style="width:72px;padding:20px 0 20px 20px"><img src="${SITE}/email/${icon}" alt="" width="44" height="44" style="display:block;width:44px;height:44px;border:0"></td><td valign="top" style="padding:19px 20px 19px 8px"><p style="margin:0 0 5px;color:#0f1115;font-size:17px;line-height:135%;font-weight:800">${title}</p><p style="margin:0 0 10px;color:#4a4e57;font-size:14px;line-height:150%">${description}</p><p style="margin:0;font-size:14px;line-height:145%;font-weight:700"><a href="${href}" style="color:#bf3a10;text-decoration:underline">${label}</a></p></td></tr></table>`;
}

export function memberWelcomeEmail({ givenName, action, unsubscribeUrl }: WelcomeEmail): {
  text: string;
  html: string;
} {
  const name = givenName.trim();
  const heading = name ? `Welcome to LVBT, ${name}!` : 'Welcome to LVBT!';
  const intro = 'Thanks for joining Las Vegans for Better Transit.';
  const frequency =
    'We’ll send updates and invitations about 1–2 times a week. You can leave LVBT at any time.';
  const text = [
    heading,
    '',
    intro,
    frequency,
    '',
    'Your first step',
    action.title,
    action.description,
    `${action.label}: ${action.href}`,
    '',
    'Get involved with LVBT',
    'Discord: meet members, ask questions, and help plan the work. https://discord.gg/Pfzk5p8QNV',
    'Instagram: see quick updates, event news, and ways to show up. https://instagram.com/lasvegasfortransit',
    `More ways to help: ${SITE}/go/`,
    '',
    'Questions? Reply to this email. We’d love to hear from you.',
    '',
    'Las Vegans for Better Transit',
    `Unsubscribe from LVBT: ${unsubscribeUrl}`,
  ].join('\n');
  const h = escapeHtml(heading);
  const title = escapeHtml(action.title);
  const description = escapeHtml(action.description);
  const label = escapeHtml(action.label);
  const href = escapeHtml(action.href);
  const unsubscribe = escapeHtml(unsubscribeUrl);
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light"><title>${h}</title><style type="text/css">@font-face{font-family:'Public Sans';src:url('${SITE}/fonts/public-sans-latin.woff2') format('woff2');font-style:normal;font-weight:100 900;mso-font-alt:Arial}@media only screen and (max-width:640px){.outer{padding:0!important}.email{width:100%!important}.brand{padding:28px 24px 22px!important}.main{padding:8px 24px 34px!important}.footer{padding:28px 24px 32px!important}.headline{font-size:36px!important;line-height:110%!important}.card{padding:24px!important}}</style><!--[if mso]><style type="text/css">body,table,td,h1,h2,p,a,span{font-family:Arial,Helvetica,sans-serif!important}</style><![endif]--></head><body style="margin:0;padding:0;background-color:#efe9db;color:#0f1115;font-family:'Public Sans',Arial,Helvetica,sans-serif"><table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" bgcolor="#efe9db" style="border-collapse:collapse;background-color:#efe9db;mso-table-lspace:0pt;mso-table-rspace:0pt;font-family:'Public Sans',Arial,Helvetica,sans-serif"><tr><td class="outer" align="center" style="padding:46px 20px 72px"><!--[if mso]><table role="presentation" cellpadding="0" cellspacing="0" border="0" width="620" align="center"><tr><td><![endif]--><table role="presentation" cellpadding="0" cellspacing="0" border="0" class="email" width="100%" bgcolor="#f7f4ec" style="width:100%;max-width:620px;border-collapse:collapse;background-color:#f7f4ec;mso-table-lspace:0pt;mso-table-rspace:0pt;font-family:'Public Sans',Arial,Helvetica,sans-serif"><tr><td height="8" bgcolor="#e5471a" style="height:8px;background-color:#e5471a;font-size:0;line-height:0">&nbsp;</td></tr><tr><td class="brand" style="padding:36px 48px 26px"><p style="margin:0;color:#0f1115;font-size:18px;line-height:110%;font-weight:800;letter-spacing:-0.6px"><a href="${SITE}/" style="color:#0f1115;text-decoration:none">Las Vegans<br><span style="color:#e5471a">for Better Transit</span></a></p></td></tr><tr><td class="main" style="padding:10px 48px 44px"><table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;mso-table-lspace:0pt;mso-table-rspace:0pt"><tr><td style="padding:0 0 24px"><h1 class="headline" style="margin:0;color:#0f1115;font-size:42px;line-height:110%;letter-spacing:-1.6px;font-weight:800">${h}</h1></td></tr><tr><td style="padding:0 0 17px"><p style="margin:0;color:#0f1115;font-size:17px;line-height:155%">${intro}</p></td></tr><tr><td style="padding:0 0 34px"><p style="margin:0;color:#4a4e57;font-size:16px;line-height:160%">${frequency}</p></td></tr><tr><td><table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" bgcolor="#ffe9d6" style="border-collapse:collapse;background-color:#ffe9d6;mso-table-lspace:0pt;mso-table-rspace:0pt"><tr><td width="5" bgcolor="#e5471a" style="width:5px;background-color:#e5471a;font-size:0;line-height:0">&nbsp;</td><td class="card" style="padding:29px 30px 30px"><p style="margin:0 0 9px;color:#bf3a10;font-size:14px;line-height:140%;font-weight:700">Your first step</p><h2 style="margin:0 0 12px;color:#0f1115;font-size:25px;line-height:115%;letter-spacing:-0.6px;font-weight:800">${title}</h2><p style="margin:0 0 21px;color:#0f1115;font-size:15px;line-height:155%">${description}</p><table role="presentation" cellpadding="0" cellspacing="0" border="0" bgcolor="#0f1115" style="border-collapse:collapse;background-color:#0f1115"><tr><td bgcolor="#0f1115" style="padding:15px 19px;background-color:#0f1115"><a href="${href}" style="color:#f7f4ec;font-size:16px;line-height:125%;font-weight:700;text-decoration:none">${label}</a></td></tr></table></td></tr></table></td></tr><tr><td style="padding:32px 0 0"><h2 style="margin:0 0 12px;color:#0f1115;font-size:23px;line-height:125%;letter-spacing:-0.5px;font-weight:800">Get involved with LVBT</h2><p style="margin:0 0 20px;color:#4a4e57;font-size:15px;line-height:155%">Join the conversation, follow our work, or find another way to help.</p>${communityCard({ icon: 'discord-icon.png', title: 'Discord', description: 'Meet members, ask questions, and help plan the work.', label: 'Join the server', href: 'https://discord.gg/Pfzk5p8QNV' })}${communityCard({ icon: 'instagram-icon.png', title: 'Instagram', description: 'See quick updates, event news, and ways to show up.', label: 'Follow LVBT', href: 'https://instagram.com/lasvegasfortransit' })}${communityCard({ icon: 'get-involved-icon.png', title: 'More ways to help', description: 'Volunteer, support a project, or pitch in when you can.', label: 'Explore ways to get involved', href: `${SITE}/go/` })}</td></tr><tr><td style="padding:29px 0 0"><p style="margin:0;color:#4a4e57;font-size:14px;line-height:160%">Questions? Just reply to this email. We’d love to hear from you.</p></td></tr></table></td></tr><tr><td class="footer" bgcolor="#0f1115" style="padding:29px 48px 35px;background-color:#0f1115;color:#f7f4ec"><p style="margin:0 0 13px;color:#f7f4ec;font-size:16px;line-height:140%;font-weight:700"><a href="${SITE}/" style="color:#f7f4ec;text-decoration:none">Las Vegans for Better Transit</a></p><p style="margin:0 0 18px;color:#a8acb4;font-size:13px;line-height:155%">Working for better transit in the Las Vegas Valley.</p><p style="margin:0;color:#a8acb4;font-size:13px;line-height:160%"><a href="${unsubscribe}" style="color:#ffe9d6;text-decoration:underline">Unsubscribe from LVBT</a></p></td></tr></table><!--[if mso]></td></tr></table><![endif]--></td></tr></table></body></html>`;
  return { text, html };
}
