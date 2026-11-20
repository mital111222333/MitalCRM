// MITAL CRM — the entry bot for the whole team (agents, store keepers, supervisors, РОП, admin).
// The person finds the bot in Telegram, presses «Старт», and opens MITAL CRM with the blue «Панель» button left of the input
// (or the button under the greeting). The Mini App is the usual login page: everyone signs in with his own login and password,
// and the CRM itself decides what he sees (agents and store keepers go to their cabinet, the others to the CRM).
// The bot keeps no data and knows nothing about accounts: it only greets and shows the button.
//
// Secrets: CRM_BOT_TOKEN (from @BotFather), CRM_BOT_SECRET (any long random string, letters/digits/_/-).
// Deployed with --no-verify-jwt (Telegram calls it without a Supabase key; the secret header protects it).
// One-time setup after deploy, opened once in a browser:  …/functions/v1/crm-bot?setup=<CRM_BOT_SECRET>
//   sets the webhook, the «Панель» menu button for every chat, the /start command and the bot description.
// deno-lint-ignore-file no-explicit-any

export const PANEL_URL = 'https://mital111222333.github.io/MitalCRM/?tg=1';
export const MENU_TEXT = 'Панель';
const env = (k: string) => (globalThis as any).Deno?.env.get(k) || '';
const selfUrl = () => `${env('SUPABASE_URL') || 'https://oxchgcfyzszemqlvdjjr.supabase.co'}/functions/v1/crm-bot`;

export async function tg(method: string, body: any = {}) {
  const r = await fetch(`https://api.telegram.org/bot${env('CRM_BOT_TOKEN')}/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return await r.json().catch(() => ({ ok: false, description: 'HTTP ' + r.status }));
}

const menuButton = { type: 'web_app', text: MENU_TEXT, web_app: { url: PANEL_URL } };
const esc = (s: string) => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]!));

export const greeting = (name: string) => [
  `<b>Добро пожаловать в MITAL CRM${name ? ', ' + esc(name) : ''}!</b>`,
  'Нажмите синюю кнопку <b>«Панель»</b> слева внизу (или кнопку под этим сообщением), введите свой логин и пароль — и откроется ваш аккаунт.',
  'Логин и пароль выдаёт ваш руководитель.',
  '',
  '<b>MITAL CRM ga xush kelibsiz!</b>',
  'Pastda chap tomondagi koʻk <b>«Панель»</b> tugmasini (yoki shu xabar ostidagi tugmani) bosing, login va parolingizni kiriting — akkauntingiz ochiladi.',
  'Login va parolni rahbaringiz beradi.',
].join('\n');

// any private message gets the greeting and the button; groups are ignored (the panel is personal)
export async function handleUpdate(u: any) {
  const m = u?.message, chat = m?.chat;
  if (!chat || chat.type !== 'private') return;
  await tg('setChatMenuButton', { chat_id: chat.id, menu_button: menuButton }); // in case this chat had another button
  await tg('sendMessage', { chat_id: chat.id, parse_mode: 'HTML', text: greeting(m.from?.first_name || ''),
    reply_markup: { inline_keyboard: [[{ text: '🔵 Открыть панель · Panelni ochish', web_app: { url: PANEL_URL } }]] } });
}

export async function setup() {
  const out: Record<string, any> = {};
  out.webhook = await tg('setWebhook', { url: selfUrl(), secret_token: env('CRM_BOT_SECRET'), allowed_updates: ['message'], drop_pending_updates: true });
  out.menu = await tg('setChatMenuButton', { menu_button: menuButton });
  out.commands = await tg('setMyCommands', { commands: [{ command: 'start', description: 'Открыть MITAL CRM' }] });
  out.description = await tg('setMyDescription', { description: 'MITAL CRM — вход для агентов, завскладов, супервайзеров и РОП. Нажмите «Старт», затем синюю кнопку «Панель» и войдите со своим логином и паролем.\n\nMITAL CRM — agentlar, omborchilar, supervayzerlar va ROP uchun kirish. «Start»ni, keyin koʻk «Панель» tugmasini bosing va login-parolingiz bilan kiring.' });
  out.short = await tg('setMyShortDescription', { short_description: 'Вход в MITAL CRM · MITAL CRM ga kirish' });
  return out;
}

export async function handler(req: Request): Promise<Response> {
  const secret = env('CRM_BOT_SECRET');
  if (!secret || !env('CRM_BOT_TOKEN')) return new Response('not configured', { status: 500 });
  const url = new URL(req.url);
  if (req.method === 'GET' && url.searchParams.has('setup')) {
    if (url.searchParams.get('setup') !== secret) return new Response('forbidden', { status: 403 });
    const r = await setup(), ok = Object.values(r).every((x: any) => x?.ok);
    return new Response(JSON.stringify({ ok, ...r }, null, 2), { status: ok ? 200 : 502, headers: { 'Content-Type': 'application/json' } });
  }
  if (req.method !== 'POST' || req.headers.get('x-telegram-bot-api-secret-token') !== secret) return new Response('forbidden', { status: 403 });
  try { await handleUpdate(await req.json()); } catch (e) { console.error('crm-bot:', String((e as any)?.message || e)); }
  return new Response('ok'); // always ok: Telegram must not retry the same update forever
}

if (!env('CRM_BOT_TEST')) (globalThis as any).Deno?.serve(handler);
