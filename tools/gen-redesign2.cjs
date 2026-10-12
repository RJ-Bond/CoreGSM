// Generates docs/redesign-2.html: three design directions for CoreGSM, three screens each
// A: Bento 2.0 (light)   B: Dark first   C: Minimal
const fs = require('fs');

const S = [
  { id: 1, name: '[RU] Just-Skill.Ru | Standart PvE', game: 'V Rising', ab: 'VR', c1: '#a83a5a', c2: '#ff7a59', addr: 'v.just-skill.ru:9877', p: 22, m: 40, ping: 40, st: 'ok', map: 'VRisingWorld', up: 99.8, seed: 1 },
  { id: 2, name: 'EU Survival | Выживание 1.21', game: 'Minecraft: Java', ab: 'MC', c1: '#3f9b3a', c2: '#9be15d', addr: 'play.eu-survival.net', p: 8, m: 20, ping: 118, st: 'lag', map: 'world', up: 97.2, seed: 2 },
  { id: 3, name: '[RU] Rust Vanilla x2 | Wipe 12.10', game: 'Rust', ab: 'RS', c1: '#d9482b', c2: '#ffb36b', addr: 'rust.example.org:28015', p: 46, m: 100, ping: 34, st: 'ok', map: 'Procedural Map', up: 99.9, seed: 3 },
  { id: 4, name: 'Dust2 24/7 | Public', game: 'Counter-Strike 2', ab: 'CS', c1: '#e0901a', c2: '#ffd36a', addr: 'cs.example.org:27015', p: 0, m: 0, ping: 0, st: 'bad', map: '', up: 82.4, seed: 4 },
  { id: 5, name: 'Valheim | Viking Club', game: 'Valheim', ab: 'VH', c1: '#3b7fc4', c2: '#8fd0ff', addr: '192.168.88.174:2456', p: 3, m: 10, ping: 52, st: 'ok', map: 'Midgard', up: 99.1, seed: 5 },
];
const ST = { ok: 'Онлайн', lag: 'Лаги', bad: 'Офлайн' };
const COL = { ok: '#22c55e', lag: '#f5a524', bad: '#ef4444' };

const series = (seed, n = 48, scale = 1) => Array.from({ length: n }, (_, i) => Math.max(0.05, 0.5 + 0.28 * Math.sin(i / 5 + seed) + 0.16 * Math.sin(i / 2.3 + seed * 2) + 0.05 * Math.cos(i * 1.7)) * scale);

function smooth(vals, w, h, pad = 4) {
  const max = Math.max(...vals) * 1.1, min = 0;
  const pts = vals.map((v, i) => [pad + (i / (vals.length - 1)) * (w - pad * 2), h - pad - ((v - min) / (max - min)) * (h - pad * 2)]);
  let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
    const cx = (x0 + x1) / 2;
    d += ` C${cx.toFixed(1)},${y0.toFixed(1)} ${cx.toFixed(1)},${y1.toFixed(1)} ${x1.toFixed(1)},${y1.toFixed(1)}`;
  }
  return { line: d, area: `${d} L${pts[pts.length - 1][0].toFixed(1)},${h} L${pts[0][0].toFixed(1)},${h} Z`, last: pts[pts.length - 1] };
}
let gid = 0;
function chart(seed, w, h, color, opts = {}) {
  const id = `g${gid++}`;
  const { line, area, last } = smooth(series(seed), w, h);
  return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" class="chart" aria-hidden="true"><defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity="${opts.fill ?? 0.35}"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>${opts.grid ? [1, 2, 3].map((k) => `<line x1="0" x2="${w}" y1="${(h / 4) * k}" y2="${(h / 4) * k}" stroke="currentColor" stroke-opacity=".08" stroke-dasharray="3 5"/>`).join('') : ''}<path d="${area}" fill="url(#${id})"/><path d="${line}" fill="none" stroke="${color}" stroke-width="${opts.sw ?? 2.2}" stroke-linecap="round" vector-effect="non-scaling-stroke"/>${opts.dot ? `<circle cx="${last[0]}" cy="${last[1]}" r="4.5" fill="${color}"/><circle cx="${last[0]}" cy="${last[1]}" r="9" fill="${color}" fill-opacity=".25"/>` : ''}</svg>`;
}
const pill = (st) => `<span class="pill ${st}"><i></i>${ST[st]}</span>`;
const players = ['Hustler', 'qlte', 'Kartoshka', 'Nikifor', 'YabaDaba', 'UnLuck', 'Psichoz', 'Slibzacula', 'Shilus', 'Anri'].map((n, i) => ({ n, t: [192, 134, 118, 96, 75, 62, 41, 28, 14, 6][i] }));
const dur = (m) => (m >= 60 ? `${Math.floor(m / 60)} ч ${m % 60} мин` : `${m} мин`);
const logo = '<span class="lg">C</span>';

// ---------------------------------------------------------------- A: Bento 2.0
function A1() {
  const [h, ...rest] = S;
  const tile = (s) => `<article class="tile sm"><div class="cover" style="background:linear-gradient(135deg,${s.c1},${s.c2})"><span class="av">${s.ab}</span>${pill(s.st)}</div><h3>${s.name}</h3><div class="meta">${s.game}</div>${s.st === 'bad' ? '<div class="err">Не отвечает · был онлайн 12 мин назад</div>' : `<div class="num"><b>${s.p}</b><span>/ ${s.m}</span><em>${s.ping} мс</em></div>${chart(s.seed, 200, 38, s.c1, { sw: 1.8, fill: 0.25 })}`}</article>`;
  return `<div class="app"><header class="glass"><div class="brand">${logo}<b>CoreGSM</b></div><nav><a class="on">Серверы</a><a>Новости</a><a>Статус</a><a>Админка</a></nav><div class="search">⌕ Поиск <kbd>Ctrl K</kbd></div><span class="me">И</span></header>
<main><div class="bento">
<article class="tile hero" style="--c1:${h.c1};--c2:${h.c2}"><div class="top"><span class="av">${h.ab}</span><div><h2>${h.name}</h2><div class="meta">${h.game} · <code>${h.addr}</code></div></div>${pill(h.st)}</div><div class="big"><b>${h.p}</b><span>/ ${h.m} игроков</span><em>пинг ${h.ping} мс</em></div>${chart(h.seed, 560, 120, '#ffffff', { dot: true, fill: 0.4, sw: 2.6 })}<div class="foot"><span>за 24 часа</span><span>аптайм ${h.up}%</span><span>карта ${h.map}</span></div></article>
<article class="tile stat"><div class="k">Серверов</div><div class="v">5</div><div class="s">4 онлайн</div></article>
<article class="tile stat"><div class="k">Игроков сейчас</div><div class="v">79</div><div class="s">+12 за час</div></article>
<article class="tile stat"><div class="k">Средний пинг</div><div class="v">56<small> мс</small></div><div class="s">норма</div></article>
<article class="tile stat"><div class="k">Аптайм 30 дн</div><div class="v">95.7<small>%</small></div><div class="s">1 сервер падал</div></article>
${rest.map(tile).join('')}
</div></main></div>`;
}
function A2() {
  const s = S[0];
  return `<div class="app"><header class="glass"><div class="brand">${logo}<b>CoreGSM</b></div><nav><a class="on">Серверы</a><a>Новости</a><a>Статус</a><a>Админка</a></nav><div class="search">⌕ Поиск <kbd>Ctrl K</kbd></div><span class="me">И</span></header>
<main><a class="back">← Все серверы</a>
<article class="tile banner" style="--c1:${s.c1};--c2:${s.c2}"><span class="av xl">${s.ab}</span><div class="bt"><h1>${s.name}</h1><div class="meta">${s.game} · <code>${s.addr}</code></div></div><div class="acts">${pill(s.st)}<button class="b">Скопировать адрес</button><button class="b ghost">Поделиться</button></div></article>
<div class="bento d">
<article class="tile stat"><div class="k">Сейчас</div><div class="v">22<small>/40</small></div><div class="s">пинг 40 мс</div></article>
<article class="tile stat"><div class="k">Пик за сутки</div><div class="v">34</div><div class="s">вчера в 21:10</div></article>
<article class="tile stat"><div class="k">Аптайм</div><div class="v">99.8<small>%</small></div><div class="s">за 24 часа</div></article>
<article class="tile stat"><div class="k">В среднем</div><div class="v">19.4</div><div class="s">игроков онлайн</div></article>
<article class="tile chartbig"><div class="th"><h3>Игроки</h3><div class="seg"><a class="on">24 ч</a><a>7 дн</a></div></div>${chart(1, 700, 220, s.c1, { grid: true, dot: true })}<div class="axis"><span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>сейчас</span></div></article>
<article class="tile plist"><div class="th"><h3>Сейчас в игре <i>22</i></h3></div>${players.map((p) => `<div class="pl"><span class="pa">${p.n[0]}</span><b>${p.n}</b><em>${dur(p.t)}</em></div>`).join('')}</article>
</div></main></div>`;
}
function A3() {
  return `<div class="app"><header class="glass"><div class="brand">${logo}<b>CoreGSM</b></div><nav><a>Серверы</a><a>Новости</a><a>Статус</a><a class="on">Админка</a></nav><div class="search">⌕ Поиск <kbd>Ctrl K</kbd></div><span class="me">И</span></header>
<main class="adm"><aside class="tile side"><small>АДМИНКА</small><a class="on">Серверы</a><a>Discord</a><a>Новости</a><a>Оповещения</a><a>Пользователи</a><a>Журнал</a><a>Система</a><a>Настройки</a></aside>
<section><div class="ph"><h1>Серверы</h1><button class="b">+ Добавить сервер</button></div>
${S.map((s) => `<article class="tile row"><span class="av" style="background:linear-gradient(135deg,${s.c1},${s.c2})">${s.ab}</span><div class="rn"><b>${s.name}</b><small>${s.game} · ${s.addr}</small></div><div class="rp">${s.st === 'bad' ? '—' : `<b>${s.p}</b>/${s.m}`}</div>${pill(s.st)}<div class="ra"><button class="b ghost sm">Опросить</button><button class="b ghost sm">Изменить</button><button class="b danger sm">Удалить</button></div></article>`).join('')}
<article class="tile health"><div class="th"><h3>Состояние системы</h3><span class="pill ok"><i></i>Всё в порядке</span></div><div class="hg"><div><small>База</small><b>1.3 МБ</b></div><div><small>Диск свободно</b></small><b>581 ГБ</b></div><div><small>Сертификат</small><b>62 дня</b></div><div><small>Бот</small><b>в сети</b></div></div></article>
</section></main></div>`;
}

// ---------------------------------------------------------------- B: Dark first
const rail = (on) => `<aside class="rail"><span class="lg">C</span>${['▦', '◔', '✎', '◉', '☰'].map((i, k) => `<a class="${k === on ? 'on' : ''}">${i}</a>`).join('')}<span class="gap"></span><a>⚙</a><span class="me">И</span></aside>`;
function B1() {
  const card = (s) => `<article class="card ${s.st}"><div class="ch"><span class="av" style="background:linear-gradient(135deg,${s.c1},${s.c2})">${s.ab}</span><div class="rn"><b>${s.name}</b><small>${s.game}</small></div>${pill(s.st)}</div>${s.st === 'bad' ? '<div class="err">Сервер не отвечает · 12 мин</div>' : `<div class="num"><b>${s.p}</b><span>/ ${s.m}</span><em>${s.ping} мс</em></div>${chart(s.seed, 300, 56, COL[s.st], { sw: 1.8, fill: 0.3 })}`}<div class="cf"><code>${s.addr}</code><span>${s.map || 'нет данных'}</span></div></article>`;
  return `<div class="app">${rail(0)}<div class="col"><div class="top"><h1>Серверы</h1><span class="sub">4 из 5 онлайн · 79 игроков</span><div class="search">⌕ Поиск <kbd>Ctrl K</kbd></div></div>
<div class="kpis"><div><small>Онлайн</small><b>4<i>/5</i></b></div><div><small>Игроков</small><b>79</b></div><div><small>Пинг</small><b>56<i> мс</i></b></div><div><small>Аптайм</small><b>95.7<i>%</i></b></div></div>
<div class="grid">${S.map(card).join('')}</div></div></div>`;
}
function B2() {
  const s = S[0];
  return `<div class="app">${rail(0)}<div class="col"><div class="top"><a class="back">← Серверы</a><h1>${s.name}</h1>${pill('ok')}</div>
<div class="split"><section><div class="card big"><div class="th"><div><small>Игроки · 24 ч</small><div class="bn"><b>22</b><span>/ 40</span></div></div><div class="seg"><a class="on">24 ч</a><a>7 дн</a><a>30 дн</a></div></div>${chart(1, 760, 240, '#8b5cf6', { grid: true, dot: true, fill: 0.4 })}</div>
<div class="kpis tri"><div><small>Пинг</small><b>40<i> мс</i></b></div><div><small>Пик</small><b>34</b></div><div><small>Аптайм</small><b>99.8<i>%</i></b></div></div></section>
<aside><div class="card"><div class="th"><h3>Сервер</h3></div><div class="kv"><span>Игра</span><b>${s.game}</b></div><div class="kv"><span>Адрес</span><code>${s.addr}</code></div><div class="kv"><span>Карта</span><b>${s.map}</b></div><div class="kv"><span>Страна</span><b>🇵🇱 Польша</b></div><div class="btns"><button class="b">Скопировать адрес</button><button class="b ghost">Поделиться</button></div></div>
<div class="card"><div class="th"><h3>Сейчас в игре</h3><i>22</i></div>${players.slice(0, 7).map((p) => `<div class="pl"><span class="pa">${p.n[0]}</span><b>${p.n}</b><em>${dur(p.t)}</em></div>`).join('')}</div></aside></div></div></div>`;
}
function B3() {
  return `<div class="app">${rail(2)}<div class="col"><div class="top"><h1>Админка</h1><span class="sub">Оповещения</span></div>
<div class="tabs">${['Серверы', 'Discord', 'Новости', 'Оповещения', 'Пользователи', 'Журнал', 'Система'].map((t, i) => `<a class="${i === 3 ? 'on' : ''}">${t}</a>`).join('')}</div>
<div class="split"><section><div class="card"><label class="sw"><span class="knob on"></span><div><b>Оповещать о недоступности серверов</b><small>Бот напишет в канал, когда сервер перестал отвечать, и когда вернулся</small></div></label><div class="f2"><div><label>Канал</label><div class="in"># оповещения · Мой сервер</div></div><div><label>Считать упавшим через</label><div class="in">3 минуты без ответа</div></div></div><div class="btns"><button class="b">Отправить тест</button></div></div>
<div class="card"><div class="th"><h3>Последние оповещения</h3></div>${[['down', 'EU Survival', '12 мин назад'], ['up', 'Rust Vanilla x2', '2 ч назад'], ['down', 'Rust Vanilla x2', '2 ч 9 мин назад']].map((r) => `<div class="al"><span class="pill ${r[0] === 'down' ? 'bad' : 'ok'}"><i></i>${r[0] === 'down' ? 'упал' : 'вернулся'}</span><b>${r[1]}</b><em>${r[2]}</em></div>`).join('')}</div></section>
<aside><div class="card embed"><div class="th"><h3>Как выглядит в Discord</h3></div><div class="emb"><div class="et">🔴 EU Survival недоступен</div><p>📍 <code>play.eu-survival.net</code><br>Сервер не отвечает уже <b>3 мин</b></p></div></div></aside></div></div></div>`;
}

// ---------------------------------------------------------------- C: Minimal
function C1() {
  const row = (s) => `<a class="row"><i class="dot ${s.st}"></i><div class="rn"><b>${s.name}</b><small>${s.game} · ${s.addr}</small></div><div class="rs">${chart(s.seed, 120, 28, '#111', { sw: 1.4, fill: 0 })}</div><div class="rp">${s.st === 'bad' ? '<b>—</b>' : `<b>${s.p}</b><span>/${s.m}</span>`}</div><div class="rg">${s.st === 'bad' ? 'не отвечает' : s.ping + ' мс'}</div></a>`;
  return `<div class="app"><header><div class="brand">${logo}<b>CoreGSM</b></div><nav><a class="on">Серверы</a><a>Новости</a><a>Статус</a><a>Админка</a></nav><span class="me">И</span></header>
<main><div class="hero"><div class="k">Сейчас играют</div><div class="n">79</div><div class="s">на 4 из 5 серверов</div></div>
<div class="rows">${S.map(row).join('')}</div></main></div>`;
}
function C2() {
  const s = S[0];
  return `<div class="app"><header><div class="brand">${logo}<b>CoreGSM</b></div><nav><a class="on">Серверы</a><a>Новости</a><a>Статус</a><a>Админка</a></nav><span class="me">И</span></header>
<main><a class="back">← Серверы</a><div class="dh"><div><div class="k">${s.game}</div><h1>${s.name}</h1><div class="meta"><i class="dot ok"></i> Онлайн · <code>${s.addr}</code></div></div><div class="big"><b>22</b><span>/40</span></div></div>
<div class="line">${chart(1, 900, 200, '#111', { sw: 1.8, fill: 0.06, dot: true })}</div>
<div class="facts"><div><small>Пинг</small><b>40 мс</b></div><div><small>Пик за сутки</small><b>34</b></div><div><small>Аптайм</small><b>99.8%</b></div><div><small>Карта</small><b>${s.map}</b></div></div>
<h3 class="sec">Сейчас в игре</h3><div class="plist">${players.slice(0, 6).map((p) => `<div class="pl"><b>${p.n}</b><em>${dur(p.t)}</em></div>`).join('')}</div></main></div>`;
}
function C3() {
  return `<div class="app"><header><div class="brand">${logo}<b>CoreGSM</b></div><nav><a>Серверы</a><a>Новости</a><a>Статус</a><a class="on">Админка</a></nav><span class="me">И</span></header>
<main class="adm"><aside><a class="on">Серверы</a><a>Discord</a><a>Новости</a><a>Оповещения</a><a>Пользователи</a><a>Журнал</a><a>Система</a><a>Настройки</a></aside>
<section><div class="ph"><h1>Серверы</h1><button class="b">Добавить</button></div>
${S.map((s) => `<div class="arow"><i class="dot ${s.st}"></i><div class="rn"><b>${s.name}</b><small>${s.game} · ${s.addr}</small></div><div class="ra"><a>Опросить</a><a>Изменить</a><a class="del">Удалить</a></div></div>`).join('')}</section></main></div>`;
}

// ---------------------------------------------------------------- CSS
const CSS_A = `
.a{--bg:#f3f4f8;--card:#fff;--ink:#12141a;--mute:#64697a;--line:#e7e9f0;--acc:#4f46e5;font-family:Manrope,system-ui,sans-serif;background:radial-gradient(900px 400px at 85% -10%,#e4e0ff,transparent),radial-gradient(700px 360px at -5% 10%,#dff4ff,transparent),var(--bg);color:var(--ink);border-radius:20px;overflow:hidden;border:1px solid #0002}
.a *{box-sizing:border-box}.a .app{padding:14px 18px 28px;min-height:640px}
.a header.glass{position:sticky;top:0;z-index:2;display:flex;align-items:center;gap:14px;padding:8px 10px 8px 14px;background:rgba(255,255,255,.72);backdrop-filter:blur(18px);border:1px solid rgba(255,255,255,.9);border-radius:22px;box-shadow:0 8px 30px rgba(40,50,110,.08)}
.a .brand{display:flex;align-items:center;gap:9px;font-size:17px}.a .lg{width:30px;height:30px;border-radius:10px;background:linear-gradient(135deg,#6d5df5,#4338ca);color:#fff;display:grid;place-items:center;font-weight:900}
.a nav{display:flex;gap:2px;margin-left:10px;padding:3px;background:#eceef6;border-radius:99px}.a nav a{padding:7px 15px;border-radius:99px;font-weight:700;font-size:14px;color:var(--mute)}.a nav a.on{background:#fff;color:var(--ink);box-shadow:0 2px 8px rgba(40,50,110,.12)}
.a .search{margin-left:auto;padding:8px 14px;border-radius:99px;background:#eceef6;color:var(--mute);font-size:14px;font-weight:600}.a kbd{margin-left:18px;font:600 11px Manrope;padding:2px 6px;border-radius:6px;background:#fff;color:var(--mute)}
.a .me{width:34px;height:34px;border-radius:50%;background:linear-gradient(135deg,#6d5df5,#ec4899);color:#fff;display:grid;place-items:center;font-weight:800}
.a main{padding-top:18px}.a .bento{display:grid;grid-template-columns:repeat(12,1fr);gap:14px}
.a .tile{background:var(--card);border-radius:26px;border:1px solid var(--line);box-shadow:0 1px 2px rgba(20,24,40,.04),0 12px 30px rgba(40,50,110,.06);padding:18px}
.a .hero{grid-column:span 6;grid-row:span 2;background:linear-gradient(140deg,var(--c1),var(--c2));color:#fff;border:0;display:flex;flex-direction:column;gap:10px;position:relative;overflow:hidden}
.a .hero:before{content:'';position:absolute;right:-60px;top:-60px;width:260px;height:260px;border-radius:50%;background:rgba(255,255,255,.14)}
.a .top{display:flex;align-items:center;gap:12px;position:relative}.a .top h2{margin:0;font-size:18px;line-height:1.2}.a .meta{font-size:13px;opacity:.85}.a code{font:600 12px 'JetBrains Mono',monospace}
.a .av{width:40px;height:40px;border-radius:13px;background:rgba(255,255,255,.22);color:#fff;display:grid;place-items:center;font-weight:900;font-size:13px;flex:none}.a .av.xl{width:64px;height:64px;border-radius:20px;font-size:20px}
.a .tile.sm .av,.a .row .av{background:var(--c,#999)}
.a .big{display:flex;align-items:baseline;gap:8px;margin-top:6px}.a .big b{font-size:78px;line-height:1;letter-spacing:-.04em;font-weight:800}.a .big span{font-size:18px;font-weight:700;opacity:.9}.a .big em{margin-left:auto;font-style:normal;font-weight:700;opacity:.9}
.a .chart{width:100%;height:auto;display:block;margin-top:auto}.a .hero .chart{height:130px}.a .foot{display:flex;justify-content:space-between;font-size:12.5px;font-weight:700;opacity:.9}
.a .stat{grid-column:span 3;display:flex;flex-direction:column;gap:4px}.a .stat .k{font-size:13px;font-weight:700;color:var(--mute)}.a .stat .v{font-size:40px;font-weight:800;letter-spacing:-.03em;line-height:1.05}.a .stat small{font-size:18px;color:var(--mute);font-weight:700}.a .stat .s{font-size:13px;font-weight:700;color:#16a34a}
.a .tile.sm{grid-column:span 3;padding:10px 10px 14px;display:flex;flex-direction:column;gap:6px}.a .tile.sm h3{margin:6px 6px 0;font-size:14.5px;line-height:1.25}.a .tile.sm .meta{margin:0 6px;color:var(--mute)}
.a .cover{height:88px;border-radius:18px;padding:10px;display:flex;justify-content:space-between;align-items:flex-start}.a .cover .av{background:rgba(255,255,255,.25)}
.a .tile.sm .num{display:flex;align-items:baseline;gap:5px;margin:0 6px}.a .tile.sm .num b{font-size:30px;font-weight:800;letter-spacing:-.03em}.a .tile.sm .num span{color:var(--mute);font-weight:700}.a .tile.sm .num em{margin-left:auto;font-style:normal;color:var(--mute);font-size:13px;font-weight:700}
.a .tile.sm .chart{height:38px;margin:0 6px}.a .err{margin:4px 6px;padding:9px 11px;border-radius:12px;background:#fee2e2;color:#b91c1c;font-size:13px;font-weight:700}
.a .pill{display:inline-flex;align-items:center;gap:6px;padding:4px 10px;border-radius:99px;font-size:12px;font-weight:800;background:rgba(255,255,255,.9)}.a .pill i{width:7px;height:7px;border-radius:50%;background:currentColor}.a .pill.ok{color:#15803d}.a .pill.lag{color:#b45309}.a .pill.bad{color:#b91c1c}
.a .hero .pill{background:rgba(255,255,255,.25);color:#fff;margin-left:auto}.a .cover .pill{background:rgba(255,255,255,.92)}
.a .back{display:inline-block;margin:2px 0 12px 4px;font-weight:800;color:var(--acc);font-size:14px}.a .banner{display:flex;align-items:center;gap:16px;background:linear-gradient(120deg,var(--c1),var(--c2));color:#fff;border:0;margin-bottom:14px}.a .banner h1{margin:0;font-size:24px;line-height:1.15}.a .bt{min-width:0}.a .acts{margin-left:auto;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.a .b{border:0;border-radius:99px;padding:10px 18px;font:800 14px Manrope;background:linear-gradient(135deg,#6d5df5,#4338ca);color:#fff;box-shadow:0 6px 16px rgba(79,70,229,.3)}.a .banner .b{background:#fff;color:#111;box-shadow:none}.a .b.ghost{background:#eceef6;color:var(--ink);box-shadow:none}.a .banner .b.ghost{background:rgba(255,255,255,.22);color:#fff}.a .b.danger{background:#fee2e2;color:#b91c1c;box-shadow:none}.a .b.sm{padding:6px 12px;font-size:13px}
.a .bento.d .stat{grid-column:span 3}.a .chartbig{grid-column:span 8;display:flex;flex-direction:column;gap:8px}.a .chartbig .chart{height:230px;color:#000}.a .plist{grid-column:span 4;grid-row:span 1;padding-bottom:10px}
.a .th{display:flex;align-items:center;justify-content:space-between}.a .th h3{margin:0;font-size:16px}.a .th i{font-style:normal;background:#eceef6;border-radius:99px;padding:2px 9px;font-size:12px;font-weight:800;margin-left:6px}
.a .seg{display:flex;gap:2px;padding:3px;background:#eceef6;border-radius:99px}.a .seg a{padding:5px 12px;border-radius:99px;font-size:13px;font-weight:800;color:var(--mute)}.a .seg a.on{background:#fff;color:var(--ink)}
.a .axis{display:flex;justify-content:space-between;font-size:12px;color:var(--mute);font-weight:700}
.a .pl{display:flex;align-items:center;gap:10px;padding:7px 0;border-top:1px solid var(--line)}.a .pl:first-of-type{border-top:0}.a .pa{width:28px;height:28px;border-radius:9px;background:#eceef6;color:var(--acc);display:grid;place-items:center;font-weight:800;font-size:12px}.a .pl b{font-size:14px}.a .pl em{margin-left:auto;font-style:normal;color:var(--mute);font-size:13px;font-weight:600}
.a main.adm{display:grid;grid-template-columns:200px 1fr;gap:14px;align-items:start}.a .side{display:flex;flex-direction:column;gap:2px;padding:10px}.a .side small{padding:6px 10px;color:var(--mute);font-weight:800;letter-spacing:.08em;font-size:11px}.a .side a{padding:9px 12px;border-radius:14px;font-weight:700;font-size:14px;color:var(--mute)}.a .side a.on{background:linear-gradient(135deg,#6d5df5,#4338ca);color:#fff}
.a .ph{display:flex;justify-content:space-between;align-items:center;margin:0 4px 12px}.a .ph h1{margin:0;font-size:26px}
.a .row{display:flex;align-items:center;gap:14px;margin-bottom:10px;padding:12px 14px}.a .rn{flex:1;min-width:0}.a .rn b{display:block;font-size:15px}.a .rn small{color:var(--mute);font-size:12.5px}.a .rp{font-size:13px;color:var(--mute)}.a .rp b{font-size:18px;color:var(--ink);display:inline}.a .ra{display:flex;gap:6px}
.a .health{margin-top:14px}.a .hg{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-top:12px}.a .hg div{background:#f6f7fb;border-radius:16px;padding:12px}.a .hg small{display:block;color:var(--mute);font-weight:700;font-size:12px}.a .hg b{font-size:18px}
`;
const CSS_B = `
.b{--bg:#090a0e;--card:#12131a;--ink:#eceef6;--mute:#8a90a6;--line:#232532;--acc:#8b5cf6;font-family:Manrope,system-ui,sans-serif;background:radial-gradient(800px 380px at 70% -10%,rgba(139,92,246,.18),transparent),var(--bg);color:var(--ink);border-radius:20px;overflow:hidden;border:1px solid #0004}
.b *{box-sizing:border-box}.b .app{display:flex;min-height:640px}
.b .rail{width:68px;flex:none;display:flex;flex-direction:column;align-items:center;gap:8px;padding:14px 0;border-right:1px solid var(--line);background:rgba(255,255,255,.015)}.b .rail .lg{width:34px;height:34px;border-radius:11px;background:linear-gradient(135deg,#8b5cf6,#6d28d9);display:grid;place-items:center;font-weight:900;margin-bottom:10px;box-shadow:0 0 22px rgba(139,92,246,.5)}
.b .rail a{width:42px;height:42px;border-radius:13px;display:grid;place-items:center;color:var(--mute);font-size:18px}.b .rail a.on{background:rgba(139,92,246,.16);color:#c4b5fd;box-shadow:inset 0 0 0 1px rgba(139,92,246,.45)}.b .gap{flex:1}.b .me{width:34px;height:34px;border-radius:50%;background:#2a2c3a;display:grid;place-items:center;font-weight:800;font-size:13px}
.b .col{flex:1;padding:20px 24px;min-width:0}.b .top{display:flex;align-items:center;gap:12px;margin-bottom:16px;flex-wrap:wrap}.b .top h1{margin:0;font-size:24px;letter-spacing:-.02em}.b .sub{color:var(--mute);font-size:14px;font-weight:600}.b .back{color:var(--mute);font-weight:700;font-size:14px}
.b .search{margin-left:auto;padding:8px 14px;border-radius:12px;background:var(--card);border:1px solid var(--line);color:var(--mute);font-size:14px}.b kbd{margin-left:16px;font:600 11px Manrope;padding:2px 6px;border-radius:6px;background:#1c1e29}
.b .kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:14px}.b .kpis.tri{grid-template-columns:repeat(3,1fr);margin:14px 0 0}.b .kpis div{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:12px 16px}.b .kpis small{color:var(--mute);font-weight:700;font-size:12.5px}.b .kpis b{display:block;font-size:30px;letter-spacing:-.03em;margin-top:2px}.b .kpis i{font-style:normal;color:var(--mute);font-size:16px}
.b .grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}.b .card{background:var(--card);border:1px solid var(--line);border-radius:18px;padding:16px}
.b .grid .card{display:flex;flex-direction:column;gap:10px;position:relative}.b .grid .card.ok{box-shadow:inset 0 0 0 1px rgba(34,197,94,.22),0 0 30px rgba(34,197,94,.06)}.b .grid .card.lag{box-shadow:inset 0 0 0 1px rgba(245,165,36,.3),0 0 30px rgba(245,165,36,.07)}.b .grid .card.bad{box-shadow:inset 0 0 0 1px rgba(239,68,68,.3),0 0 30px rgba(239,68,68,.08)}
.b .ch{display:flex;align-items:center;gap:10px}.b .av{width:36px;height:36px;border-radius:11px;color:#fff;display:grid;place-items:center;font-weight:900;font-size:12px;flex:none}.b .rn{flex:1;min-width:0}.b .rn b{display:block;font-size:14px;line-height:1.25}.b .rn small{color:var(--mute);font-size:12px}
.b .num{display:flex;align-items:baseline;gap:6px}.b .num b{font-size:38px;letter-spacing:-.04em}.b .num span{color:var(--mute);font-weight:700}.b .num em{margin-left:auto;font-style:normal;color:var(--mute);font-size:13px;font-weight:700}.b .chart{width:100%;display:block;height:56px}.b .cf{display:flex;justify-content:space-between;color:var(--mute);font-size:12px}.b code{font:600 12px 'JetBrains Mono',monospace;color:#b9bdd0}
.b .err{padding:10px 12px;border-radius:12px;background:rgba(239,68,68,.12);color:#fca5a5;font-size:13px;font-weight:700}
.b .pill{display:inline-flex;align-items:center;gap:6px;padding:3px 10px;border-radius:99px;font-size:11.5px;font-weight:800}.b .pill i{width:6px;height:6px;border-radius:50%;background:currentColor;box-shadow:0 0 8px currentColor}.b .pill.ok{background:rgba(34,197,94,.14);color:#4ade80}.b .pill.lag{background:rgba(245,165,36,.14);color:#fbbf24}.b .pill.bad{background:rgba(239,68,68,.14);color:#f87171}
.b .split{display:grid;grid-template-columns:minmax(0,1.7fr) minmax(0,1fr);gap:14px;align-items:start}.b .split section,.b .split aside{display:flex;flex-direction:column;gap:14px}.b .card.big .chart{height:240px;color:#fff}.b .th{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px}.b .th h3{margin:0;font-size:15px}.b .th small{color:var(--mute);font-weight:700;font-size:12.5px}.b .bn{display:flex;align-items:baseline;gap:6px}.b .bn b{font-size:54px;letter-spacing:-.04em;line-height:1}.b .bn span{color:var(--mute);font-size:18px;font-weight:700}
.b .th i{font-style:normal;background:#1c1e29;border-radius:99px;padding:2px 9px;font-size:12px;font-weight:800}.b .seg{display:flex;gap:2px;padding:3px;background:#0c0d12;border:1px solid var(--line);border-radius:12px}.b .seg a{padding:5px 12px;border-radius:9px;font-size:12.5px;font-weight:800;color:var(--mute)}.b .seg a.on{background:#232532;color:#fff}
.b .kv{display:flex;justify-content:space-between;padding:9px 0;border-top:1px solid var(--line);font-size:14px}.b .kv span{color:var(--mute)}.b .btns{display:flex;gap:8px;margin-top:12px}.b .b2,.b button.b{border:0;border-radius:12px;padding:10px 16px;font:800 14px Manrope;background:linear-gradient(135deg,#8b5cf6,#6d28d9);color:#fff;box-shadow:0 6px 20px rgba(139,92,246,.35)}.b button.b.ghost{background:#232532;box-shadow:none}
.b .pl{display:flex;align-items:center;gap:10px;padding:7px 0;border-top:1px solid var(--line)}.b .pa{width:26px;height:26px;border-radius:8px;background:#232532;display:grid;place-items:center;font-weight:800;font-size:12px;color:#c4b5fd}.b .pl b{font-size:14px}.b .pl em{margin-left:auto;font-style:normal;color:var(--mute);font-size:13px}
.b .tabs{display:flex;gap:4px;margin-bottom:14px;overflow:auto}.b .tabs a{padding:8px 14px;border-radius:12px;font-weight:700;font-size:14px;color:var(--mute);white-space:nowrap}.b .tabs a.on{background:rgba(139,92,246,.16);color:#c4b5fd;box-shadow:inset 0 0 0 1px rgba(139,92,246,.4)}
.b .sw{display:flex;gap:14px;align-items:flex-start}.b .sw b{display:block}.b .sw small{color:var(--mute);font-size:13px}.b .knob{width:42px;height:24px;border-radius:99px;background:#2a2c3a;position:relative;flex:none;margin-top:2px}.b .knob.on{background:#8b5cf6}.b .knob:after{content:'';position:absolute;top:3px;left:3px;width:18px;height:18px;border-radius:50%;background:#fff}.b .knob.on:after{left:21px}
.b .f2{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:16px}.b label{font-size:12px;color:var(--mute);font-weight:800;letter-spacing:.05em;text-transform:uppercase}.b .in{margin-top:6px;padding:11px 13px;border-radius:12px;background:#0c0d12;border:1px solid var(--line);font-size:14px}
.b .al{display:flex;align-items:center;gap:10px;padding:9px 0;border-top:1px solid var(--line)}.b .al em{margin-left:auto;font-style:normal;color:var(--mute);font-size:13px}.b .emb{margin-top:8px;background:#2b2d31;border-left:4px solid #ef4444;border-radius:6px;padding:12px;font-size:14px}.b .emb .et{font-weight:800;margin-bottom:6px}
`;
const CSS_C = `
.c{--bg:#fbfbfa;--ink:#111;--mute:#76767a;--line:#e7e7e4;font-family:Manrope,system-ui,sans-serif;background:var(--bg);color:var(--ink);border-radius:20px;overflow:hidden;border:1px solid #0002}
.c *{box-sizing:border-box}.c .app{min-height:640px;padding:0 40px 40px}
.c header{display:flex;align-items:center;gap:28px;padding:22px 0;border-bottom:1px solid var(--line)}.c .brand{display:flex;align-items:center;gap:9px;font-size:16px}.c .lg{width:26px;height:26px;border-radius:8px;background:#111;color:#fff;display:grid;place-items:center;font-weight:900;font-size:13px}
.c nav{display:flex;gap:22px}.c nav a{font-weight:700;font-size:14px;color:var(--mute);padding:4px 0}.c nav a.on{color:var(--ink);box-shadow:0 2px 0 #111}.c .me{margin-left:auto;width:30px;height:30px;border-radius:50%;background:#efefec;display:grid;place-items:center;font-weight:800;font-size:12px}
.c .hero{padding:44px 0 26px}.c .k{font-size:13px;font-weight:700;color:var(--mute);letter-spacing:.02em}.c .hero .n{font-size:120px;line-height:.95;font-weight:800;letter-spacing:-.06em}.c .hero .s{font-size:16px;color:var(--mute);font-weight:600;margin-top:6px}
.c .rows{border-top:1px solid var(--ink)}.c .row{display:grid;grid-template-columns:18px minmax(0,1fr) 140px 90px 90px;align-items:center;gap:16px;padding:18px 0;border-bottom:1px solid var(--line)}.c .row:hover{background:#f4f4f1}
.c .dot{width:9px;height:9px;border-radius:50%;display:inline-block}.c .dot.ok{background:#16a34a}.c .dot.lag{background:#d97706}.c .dot.bad{background:#dc2626}.c .rn b{display:block;font-size:16px}.c .rn small{color:var(--mute);font-size:13px}.c .chart{width:100%;height:28px;display:block}.c .rp{text-align:right}.c .rp b{font-size:26px;letter-spacing:-.03em}.c .rp span{color:var(--mute);font-weight:700}.c .rg{text-align:right;color:var(--mute);font-size:13px;font-weight:700}
.c .back{display:inline-block;margin:26px 0 10px;font-weight:700;font-size:14px;color:var(--mute)}.c .dh{display:flex;align-items:flex-end;justify-content:space-between;gap:20px}.c .dh h1{margin:4px 0 8px;font-size:30px;letter-spacing:-.02em;line-height:1.15;max-width:560px}.c .meta{font-size:14px;color:var(--mute);font-weight:600}.c code{font:600 13px 'JetBrains Mono',monospace;color:var(--ink)}
.c .big{display:flex;align-items:baseline;gap:4px}.c .big b{font-size:110px;line-height:.9;font-weight:800;letter-spacing:-.06em}.c .big span{font-size:24px;color:var(--mute);font-weight:700}.c .line{margin:18px 0;border-top:1px solid var(--line);border-bottom:1px solid var(--line);padding:16px 0}.c .line .chart{height:190px}
.c .facts{display:grid;grid-template-columns:repeat(4,1fr);gap:20px}.c .facts small{display:block;color:var(--mute);font-weight:700;font-size:13px}.c .facts b{font-size:22px;letter-spacing:-.02em}.c .sec{margin:30px 0 8px;font-size:13px;color:var(--mute);letter-spacing:.06em;text-transform:uppercase}
.c .plist{display:grid;grid-template-columns:repeat(2,1fr);column-gap:40px}.c .pl{display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--line)}.c .pl em{font-style:normal;color:var(--mute);font-size:14px}
.c main.adm{display:grid;grid-template-columns:170px 1fr;gap:40px;padding-top:28px}.c .adm aside{display:flex;flex-direction:column;gap:2px}.c .adm aside a{padding:8px 0;font-weight:700;font-size:14px;color:var(--mute)}.c .adm aside a.on{color:var(--ink);box-shadow:-12px 0 0 -10px #111;padding-left:12px;margin-left:-12px}
.c .ph{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px}.c .ph h1{margin:0;font-size:28px;letter-spacing:-.02em}.c .b{border:0;border-radius:8px;background:#111;color:#fff;padding:9px 16px;font:700 14px Manrope}.c .arow{display:grid;grid-template-columns:18px minmax(0,1fr) auto;gap:16px;align-items:center;padding:16px 0;border-bottom:1px solid var(--line)}.c .ra{display:flex;gap:18px}.c .ra a{font-size:14px;font-weight:700;color:var(--ink)}.c .ra a.del{color:#dc2626}
`;

const note = {
  A: 'Светлый «bento 2.0»: обложки игр, крупные графики, стеклянная шапка, мягкие многослойные тени. Главный сервер крупной плиткой.',
  B: 'Тёмная тема по умолчанию: узкая иконочная колонка слева, неоновая подсветка статуса по краю карточки, плотная сетка и крупные цифры.',
  C: 'Минимализм: почти без рамок и теней, строки вместо карточек, огромные цифры, один акцент: цвет статуса.',
};
const frames = (cls, title, sub, items) => `<section class="blk"><h2>${title}</h2><p>${sub}</p>${items.map(([cap, html]) => `<p class="cap">${cap}</p><div class="${cls}">${html}</div>`).join('')}</section>`;

const out = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>CoreGSM Redesign 2</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Manrope:wght@500;600;700;800&family=JetBrains+Mono:wght@500;600&display=swap">
<style>
:root{--pbg:#e9e8e4;--pfg:#161616;--pmut:#6b6b6b}@media(prefers-color-scheme:dark){:root:not([data-theme=light]){--pbg:#101012;--pfg:#eee;--pmut:#9a9a9a;color-scheme:dark}}
*{box-sizing:border-box}body{margin:0;background:var(--pbg);color:var(--pfg);font:15px/1.5 Manrope,system-ui,sans-serif;padding:32px 16px}.wrap{max-width:1180px;margin:0 auto;display:flex;flex-direction:column;gap:64px}
h1.t{font-size:clamp(28px,5vw,42px);margin:0 0 8px;letter-spacing:-.02em}.lead{color:var(--pmut);max-width:72ch;margin:0}.blk h2{margin:0 0 4px;font-size:24px}.blk>p{margin:0 0 14px;color:var(--pmut);max-width:80ch}.cap{margin:22px 0 8px!important;font-size:12px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--pmut)}
a{text-decoration:none;color:inherit}
${CSS_A}${CSS_B}${CSS_C}
@media(max-width:900px){.a .bento,.b .split,.a main.adm,.c main.adm{grid-template-columns:1fr}.a .hero,.a .stat,.a .tile.sm,.a .chartbig,.a .plist{grid-column:auto}.b .grid{grid-template-columns:1fr 1fr}.b .kpis{grid-template-columns:1fr 1fr}.c .row{grid-template-columns:18px 1fr 70px}.c .rs,.c .rg{display:none}.c .facts{grid-template-columns:1fr 1fr}.c .plist{grid-template-columns:1fr}.a .hg{grid-template-columns:1fr 1fr}}
</style></head><body><div class="wrap">
<div><h1 class="t">CoreGSM: три направления современного дизайна</h1><p class="lead">Для каждого направления три экрана: <b>список серверов</b>, <b>страница сервера</b> и <b>Админка</b>. Данные одинаковые, чтобы сравнивать только подачу. Скажите, какое направление берём (или что смешать), и я перенесу его в панель.</p></div>
${frames('a', 'A. Bento 2.0 (светлый)', note.A, [['Серверы', A1()], ['Страница сервера', A2()], ['Админка · Серверы', A3()]])}
${frames('b', 'B. Dark first (тёмный)', note.B, [['Серверы', B1()], ['Страница сервера', B2()], ['Админка · Оповещения', B3()]])}
${frames('c', 'C. Минимализм', note.C, [['Серверы', C1()], ['Страница сервера', C2()], ['Админка · Серверы', C3()]])}
</div></body></html>`;
fs.writeFileSync(process.argv[2] || 'docs/redesign-2.html', out);
console.log('ok', out.length);
