// Generates docs/redesign-10.html: ten modern redesign mockups (player view + "Админка")
const fs = require('fs');
const D = [
  { n: 'Linear Night', d: 'Графитово-индиго, тонкие рамки, плотная аккуратная сетка. Левая колонка, «Админка» отдельной секцией.', f: 'Inter', layout: 'side', card: 'tile', v: { bg: '#0f1012', sf: '#16171a', ink: '#ececef', mute: '#8a8f98', line: '#26272b', acc: '#7170ff', on: '#fff', soft: '#1d1e22', r: '10px', sh: 'none', bd: '1px' } },
  { n: 'Mono Studio', d: 'Чёрно-белый минимализм в духе Vercel: волосяные линии, строки-таблица, единственный акцент — статус.', f: 'Geist', layout: 'top', card: 'row', v: { bg: '#fff', sf: '#fff', ink: '#0a0a0a', mute: '#6b6b6b', line: '#e6e6e6', acc: '#0a0a0a', on: '#fff', soft: '#f5f5f5', r: '8px', sh: 'none', bd: '1px' } },
  { n: 'Glass Aurora', d: 'Тёмный градиент, стеклянные карточки, плавающий док снизу. Эффектно и современно.', f: 'Outfit', layout: 'dock', card: 'tile', v: { bg: 'radial-gradient(1000px 560px at 8% -10%,#40308a,transparent),radial-gradient(800px 480px at 100% 0,#0e5a6b,transparent),#0c0e1a', sf: 'rgba(255,255,255,.07)', ink: '#f1f3ff', mute: '#9aa3c7', line: 'rgba(255,255,255,.13)', acc: '#8b9bff', on: '#0c0e1a', soft: 'rgba(255,255,255,.08)', r: '20px', sh: '0 10px 40px rgba(0,0,0,.35)', bd: '1px', blur: 1 } },
  { n: 'Bento Light', d: 'Светлая «бенто»-сетка: плитки разного размера, главный сервер крупно, мягкие скругления.', f: 'Plus Jakarta Sans', layout: 'top', card: 'hero', v: { bg: '#f4f5f7', sf: '#fff', ink: '#14161a', mute: '#6b7280', line: '#e8eaee', acc: '#4f46e5', on: '#fff', soft: '#eef0f4', r: '24px', sh: '0 1px 2px rgba(16,24,40,.05)', bd: '1px' } },
  { n: 'Discord Modern', d: 'Привычный игрокам Discord, но чище: тёмный графит, колонка разделов, фирменный фиолетово-синий.', f: 'Manrope', layout: 'side', card: 'tile', v: { bg: '#313338', sf: '#2b2d31', ink: '#f2f3f5', mute: '#a0a5ae', line: '#232428', acc: '#5865f2', on: '#fff', soft: '#383a40', r: '12px', sh: 'none', bd: '0' } },
  { n: 'Notion Calm', d: 'Тёплый светлый «документный» вид: спокойные тона, мягкие линии, ничего не отвлекает от данных.', f: 'Inter', layout: 'side', card: 'row', v: { bg: '#fbfaf8', sf: '#f4f2ee', ink: '#2b2a27', mute: '#8a857b', line: '#e8e4dc', acc: '#2f6fed', on: '#fff', soft: '#efece5', r: '8px', sh: 'none', bd: '1px' } },
  { n: 'Gradient Pop', d: 'Яркий градиент фиолетовый → розовый на акцентах и главной карточке, светлый фон. Молодой и заметный.', f: 'Sora', layout: 'top', card: 'hero', v: { bg: '#faf8ff', sf: '#fff', ink: '#1d1535', mute: '#7b72a1', line: '#ece6fb', acc: 'linear-gradient(135deg,#7c3aed,#ec4899)', on: '#fff', soft: '#f3eefe', r: '20px', sh: '0 10px 30px rgba(124,58,237,.10)', bd: '1px', grad: 1 } },
  { n: 'Raycast Dark', d: 'Глубокий чёрный с красным акцентом, «командная» строка поиска сверху, сегменты-переключатели, док снизу.', f: 'Inter', layout: 'dock', card: 'row', v: { bg: '#0a0a0b', sf: '#131315', ink: '#f4f4f5', mute: '#8b8b93', line: '#232326', acc: '#ff5a4d', on: '#fff', soft: '#1b1b1e', r: '14px', sh: 'none', bd: '1px' } },
  { n: 'Stripe Clean', d: 'Деловой светлый вид: строки-таблица, мягкий градиентный акцент, тонкие тени. Хорошо для большого числа серверов.', f: 'Manrope', layout: 'top', card: 'row', v: { bg: '#f6f9fc', sf: '#fff', ink: '#0a2540', mute: '#697386', line: '#e3e8ee', acc: '#635bff', on: '#fff', soft: '#eef2f8', r: '10px', sh: '0 1px 3px rgba(50,50,93,.10)', bd: '1px' } },
  { n: 'Soft Glass Light', d: 'Светлое матовое стекло в духе iOS: воздушно, крупные скругления, нижний док. Самый «лёгкий» вариант.', f: 'Outfit', layout: 'dock', card: 'tile', v: { bg: 'linear-gradient(160deg,#e8efff,#f6ecff 55%,#ffeef2)', sf: 'rgba(255,255,255,.7)', ink: '#1c2033', mute: '#6f7691', line: 'rgba(255,255,255,.9)', acc: '#3b82f6', on: '#fff', soft: 'rgba(255,255,255,.65)', r: '26px', sh: '0 10px 30px rgba(80,90,160,.12)', bd: '1px', blur: 1 } },
];
const SRV = [
  { g: 'V Rising', c: '#a83a5a', ab: 'VR', name: '[RU] Just-Skill.Ru | Standart PvE', addr: 'v.just-skill.ru:9877', p: 22, m: 40, ping: 40, map: 'VRisingWorld', st: 'ok' },
  { g: 'Minecraft', c: '#62b543', ab: 'MC', name: 'Survival Craft — сезон 4', addr: 'mc.example.org', p: 8, m: 20, ping: 118, map: 'world', st: 'lag' },
  { g: 'Counter-Strike 2', c: '#f0a020', ab: 'CS', name: 'Dust2 24/7 Public', addr: 'cs.example.org:27015', p: 0, m: 0, ping: 0, map: '', st: 'bad' },
];
const NAV = ['Серверы', 'Новости'];
const ADM = ['Серверы', 'Discord', 'Новости', 'Карточки', 'Пользователи', 'Настройки'];
const stLabel = { ok: 'Онлайн', lag: 'Лаги', bad: 'Офлайн' };

const pill = (s) => `<span class="pill ${s.st}"><i></i>${stLabel[s.st]}</span>`;
const bar = (s) => `<div class="bar"><b style="width:${s.m ? Math.round((s.p / s.m) * 100) : 0}%;background:${s.c}"></b></div>`;
function card(s, kind, i) {
  const av = `<span class="av" style="background:${s.c}">${s.ab}</span>`;
  if (kind === 'row')
    return `<div class="row">${av}<div class="rn"><b>${s.name}</b><small>${s.g} · ${s.addr}</small></div><div class="rp">${s.st === 'bad' ? '—' : `<b>${s.p}</b>/${s.m}`}</div><div class="rb">${bar(s)}</div><div class="rg">${s.st === 'bad' ? '' : s.ping + ' мс'}</div>${pill(s)}</div>`;
  const big = kind === 'hero' && i === 0;
  const spark = big ? `<div class="spark">${Array.from({ length: 30 }, (_, k) => `<u style="height:${28 + Math.round(42 * Math.abs(Math.sin(k / 3)))}%"></u>`).join('')}</div>` : '';
  return `<div class="card${big ? ' big' : ''}"><div class="ch">${av}<div class="rn"><b>${s.name}</b><small>${s.g}</small></div>${pill(s)}</div>${
    s.st === 'bad' ? '<div class="err">Не отвечает · был онлайн 12 мин назад</div>' : `<div class="num"><b>${s.p}</b><span>/ ${s.m}</span><em>${s.ping} мс</em></div>${bar(s)}${spark}`
  }<div class="cf"><code>${s.addr}</code><span>${s.map}</span></div></div>`;
}
const logo = () => '<div class="logo"><span class="lg">C</span><b>CoreGSM</b></div>';
function playerView(d) {
  const items = SRV.map((s, i) => card(s, d.card, i)).join('');
  const search = d.layout === 'dock' && d.card === 'row' ? '<div class="in srch">⌕ Найти сервер…  <kbd>/</kbd></div>' : '';
  const body = `<div class="ph"><h2>Серверы</h2><span class="sub">2 из 3 онлайн · 30 игроков</span></div>${search}<div class="${d.card === 'row' ? 'list' : 'grid'}">${items}</div>`;
  const user = '<span class="chip"><i>И</i>Иван</span>';
  const nav = NAV.map((x, i) => `<a class="${i === 0 ? 'on' : ''}">${x}</a>`).join('');
  if (d.layout === 'side') return `<div class="app side"><aside>${logo()}${nav}<span class="gap"></span><a class="adm">⚙ Админка</a>${user}</aside><main>${body}</main></div>`;
  if (d.layout === 'dock') return `<div class="app dock"><header>${logo()}<span class="gap"></span>${user}</header><main>${body}</main><nav class="dk">${nav}<a class="adm">⚙ Админка</a></nav></div>`;
  return `<div class="app top"><header>${logo()}<nav>${nav}</nav><span class="gap"></span><a class="adm">⚙ Админка</a>${user}</header><main>${body}</main></div>`;
}
const adminBody = () => `<div class="ph"><h2>Новости</h2><span class="sub">Публикации от имени бота в Discord</span><button class="btn">+ Написать новость</button></div>
<div class="two"><div class="panel"><label>Канал</label><div class="in"># новости · Мой сервер</div><label>Заголовок</label><div class="in">Вайп в пятницу в 18:00</div><label>Текст</label><div class="in ta">Друзья, в эту пятницу проводим плановый вайп.<br>• Новые награды за онлайн<br>• Обновлён баланс</div><div class="acts"><button class="btn ghost">Черновик</button><button class="btn">Опубликовать в Discord</button></div></div>
<div class="panel"><label>Предпросмотр</label><div class="emb"><b>Вайп в пятницу в 18:00</b><p>Друзья, в эту пятницу проводим плановый вайп.<br>• Новые награды за онлайн<br>• Обновлён баланс</p></div></div></div>`;
function adminView(d) {
  const tabs = ADM.map((x, i) => `<a class="${i === 2 ? 'on' : ''}">${x}</a>`).join('');
  if (d.layout === 'side') return `<div class="app side"><aside>${logo()}<small class="cap">АДМИНКА</small>${tabs}<span class="gap"></span><a>← К панели</a></aside><main>${adminBody()}</main></div>`;
  const nav = NAV.map((x) => `<a>${x}</a>`).join('');
  if (d.layout === 'dock') return `<div class="app dock"><header>${logo()}<span class="gap"></span><a class="adm on">⚙ Админка</a></header><main><div class="tabs">${tabs}</div>${adminBody()}</main></div>`;
  return `<div class="app top"><header>${logo()}<nav>${nav}</nav><span class="gap"></span><a class="adm on">⚙ Админка</a></header><main><div class="tabs">${tabs}</div>${adminBody()}</main></div>`;
}
function css(d, k) {
  const v = d.v, s = `.d${k}`;
  const bd = v.bd === '0' ? 'none' : `${v.bd} solid ${v.line}`;
  const accBg = v.acc;
  const fillOn = `background:${accBg};color:${v.on}`;
  const blur = v.blur ? 'backdrop-filter:blur(16px);' : '';
  return `${s}{background:${v.bg};color:${v.ink};font-family:'${d.f}',Inter,system-ui,sans-serif;border-radius:18px;overflow:hidden;border:1px solid #00000022}
${s} *{box-sizing:border-box}${s} .app{display:flex;min-height:560px;position:relative}${s} .app.top,${s} .app.dock{flex-direction:column}
${s} header{display:flex;align-items:center;gap:14px;padding:14px 22px;${d.layout === 'top' ? `border-bottom:${bd};` : ''}}
${s} .gap{flex:1}${s} .logo{display:flex;align-items:center;gap:9px;font-size:17px}${s} .lg{width:30px;height:30px;border-radius:9px;${fillOn};display:grid;place-items:center;font-weight:900}
${s} nav{display:flex;gap:4px}${s} nav a,${s} .tabs a{padding:7px 14px;border-radius:99px;font-weight:600;color:${v.mute};font-size:14px}
${s} nav a.on,${s} .tabs a.on{${fillOn}}${s} .tabs{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:18px}${s} .tabs a{background:${v.soft}}
${s} .adm{padding:7px 14px;border-radius:99px;border:${bd.replace(/solid .*/, 'solid')} ${v.line};color:${v.ink};font-weight:700;font-size:14px;background:${v.soft}}${s} .adm.on{${fillOn};border-color:transparent}
${s} .chip{display:flex;align-items:center;gap:8px;padding:4px 12px 4px 4px;border-radius:99px;background:${v.soft};font-weight:600;font-size:14px}${s} .chip i{width:26px;height:26px;border-radius:50%;${fillOn};display:grid;place-items:center;font-style:normal;font-size:13px}
${s} main{flex:1;padding:24px;min-width:0}${s} .ph{display:flex;align-items:baseline;gap:12px;flex-wrap:wrap;margin-bottom:18px}${s} .ph h2{margin:0;font-size:26px;font-weight:700;letter-spacing:-.02em}${s} .sub{color:${v.mute};font-size:14px}${s} .ph .btn{margin-left:auto}
${s} .app.side aside{width:208px;flex:none;padding:16px 12px;display:flex;flex-direction:column;gap:3px;background:${v.sf};border-right:${bd}}
${s} aside a{padding:9px 12px;border-radius:${v.r};font-weight:600;color:${v.mute};font-size:14px}${s} aside a.on{${fillOn}}${s} aside .adm{margin-top:6px;text-align:center}${s} aside .logo{padding:4px 6px 14px}${s} .cap{color:${v.mute};font-size:11px;letter-spacing:.1em;padding:6px 12px}
${s} .dk{position:absolute;left:50%;bottom:18px;transform:translateX(-50%);display:flex;gap:4px;padding:6px;background:${v.sf};border:${bd};border-radius:99px;box-shadow:${v.sh === 'none' ? '0 8px 30px rgba(0,0,0,.25)' : v.sh};${blur}}${s} .dk a{padding:9px 18px;border-radius:99px;font-weight:600;color:${v.mute};font-size:14px}${s} .dk a.on{${fillOn}}${s} .dk .adm{border:0}
${s} .app.dock main{padding-bottom:92px}${s} .srch{margin-bottom:14px;color:${v.mute}}${s} kbd{float:right;border:${bd};border-radius:5px;padding:0 6px;font-size:12px}
${s} .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:14px}${s} .list{display:flex;flex-direction:column;gap:8px}
${s} .card,${s} .row,${s} .panel{background:${v.sf};border:${bd};border-radius:${v.r};box-shadow:${v.sh};${blur}}
${s} .card{padding:18px;display:flex;flex-direction:column;gap:12px}${s} .card.big{grid-column:span 2;${v.grad ? `background:${accBg};color:#fff;border:0` : ''}}${s} .card.big small,${s} .card.big .cf,${s} .card.big .num span,${s} .card.big .num em{${v.grad ? 'color:#ffffffcc' : ''}}${s} .ch{display:flex;align-items:center;gap:11px}
${s} .av{width:38px;height:38px;border-radius:11px;color:#fff;display:grid;place-items:center;font-weight:800;font-size:13px;flex:none}${s} .rn{min-width:0;flex:1}${s} .rn b{display:block;line-height:1.25;font-size:15px;font-weight:650}${s} .rn small{color:${v.mute};font-size:12px}
${s} .num{display:flex;align-items:baseline;gap:6px}${s} .num b{font-size:34px;font-weight:700;letter-spacing:-.03em}${s} .num span{color:${v.mute};font-weight:600}${s} .num em{margin-left:auto;color:${v.mute};font-style:normal;font-size:13px}
${s} .bar{height:6px;border-radius:99px;background:${v.soft};overflow:hidden}${s} .bar b{display:block;height:100%;border-radius:99px}${s} .card.big .bar{background:#ffffff40}${s} .card.big .bar b{background:#fff!important}
${s} .spark{display:flex;align-items:flex-end;gap:3px;height:48px}${s} .spark u{flex:1;background:${v.grad ? '#fff' : accBg};opacity:.5;border-radius:3px 3px 0 0}
${s} .cf{display:flex;justify-content:space-between;gap:8px;color:${v.mute};font-size:12px}${s} code{font-family:'JetBrains Mono',monospace;font-size:12px}
${s} .err{background:#f23f4222;color:#e5484d;border-radius:10px;padding:9px 12px;font-size:13px;font-weight:600}
${s} .pill{display:inline-flex;align-items:center;gap:6px;padding:4px 10px;border-radius:99px;font-size:12px;font-weight:700;white-space:nowrap}${s} .pill i{width:7px;height:7px;border-radius:50%;background:currentColor}
${s} .pill.ok{background:#23a55a26;color:#2bb766}${s} .pill.lag{background:#f0b23226;color:#d99a12}${s} .pill.bad{background:#f23f4226;color:#e5484d}
${s} .card.big .pill{background:#ffffff30;color:#fff}
${s} .row{display:grid;grid-template-columns:38px minmax(0,2.4fr) 70px minmax(60px,1fr) 60px auto;align-items:center;gap:14px;padding:11px 16px}${s} .rp b{font-size:18px}${s} .rg{color:${v.mute};font-size:13px;text-align:right}
${s} .btn{${fillOn};border:0;border-radius:${v.r};padding:9px 16px;font:700 14px '${d.f}',Inter,sans-serif}${s} .btn.ghost{background:${v.soft};color:${v.ink}}
${s} .two{display:grid;grid-template-columns:minmax(0,1.3fr) minmax(0,1fr);gap:14px}${s} .panel{padding:18px;display:flex;flex-direction:column;gap:8px}${s} label{font-size:12px;font-weight:700;color:${v.mute};letter-spacing:.04em;text-transform:uppercase}
${s} .in{background:${v.soft};border-radius:calc(${v.r} * .7);padding:10px 12px;font-size:14px}${s} .in.ta{min-height:96px;line-height:1.5}${s} .acts{display:flex;gap:8px;justify-content:flex-end;margin-top:4px}
${s} .emb{background:#2b2d31;color:#f2f3f5;border-left:4px solid #5865f2;border-radius:4px;padding:10px 12px;font-family:system-ui;font-size:14px}${s} .emb p{margin:6px 0 0;color:#dbdee1;font-size:13px}
@media(max-width:760px){${s} .two{grid-template-columns:1fr}${s} .app.side{flex-direction:column}${s} .app.side aside{width:auto;flex-direction:row;flex-wrap:wrap}${s} .row{grid-template-columns:38px 1fr auto}${s} .rb,${s} .rg{display:none}${s} .card.big{grid-column:auto}}`;
}
const out = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>CoreGSM Redesign</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&family=JetBrains+Mono:wght@400;700&family=Outfit:wght@400;600;700&family=Plus+Jakarta+Sans:wght@500;700&family=Sora:wght@400;600;700&family=Manrope:wght@500;700;800&family=Geist:wght@400;600;700&display=swap">
<style>:root{--bg:#eceae6;--fg:#1b1b1d;--mut:#666}@media(prefers-color-scheme:dark){:root:not([data-theme=light]){--bg:#141416;--fg:#eee;--mut:#999;color-scheme:dark}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 Inter,system-ui,sans-serif;padding:32px 16px}.w{max-width:1100px;margin:0 auto;display:flex;flex-direction:column;gap:56px}
h1{font:700 clamp(28px,5vw,40px)/1.1 Inter;margin:0 0 8px}.lead{color:var(--mut);max-width:70ch;margin:0}.fr h3{margin:0 0 4px;font:700 20px Inter}.fr p{margin:0 0 12px;color:var(--mut);max-width:80ch}.pair{display:grid;gap:16px}.fr .cap{font-size:12px;font-weight:700;letter-spacing:.08em;color:var(--mut);margin:0 0 6px;text-transform:uppercase}
a{text-decoration:none;color:inherit}
${D.map((d, i) => css(d, i + 1)).join('\n')}</style></head><body><div class="w">
<div><h1>CoreGSM — редизайн: 10 современных макетов</h1><p class="lead">В каждом макете два экрана: <b>главная</b> (серверы, кнопка «Админка» видна только администратору) и <b>Админка</b> — отдельный раздел, где теперь всё управление: серверы, привязки Discord, новости в канал, карточки, пользователи, настройки. Игрокам доступны «Серверы» и «Новости» (чтение). В embed убрана полоска под игроками.</p></div>
${D.map((d, i) => `<section class="fr"><h3>${i + 1}. ${d.n}</h3><p>${d.d}</p><div class="pair"><div><p class="cap">Главная</p><div class="d${i + 1}">${playerView(d)}</div></div><div><p class="cap">Админка: новости в Discord</p><div class="d${i + 1}">${adminView(d)}</div></div></div></section>`).join('\n')}
</div></body></html>`;
fs.writeFileSync(process.argv[2] || 'docs/redesign-10.html', out);
console.log('ok', out.length);
