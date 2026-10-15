/**
 * «Сообщество»: the public showcase. Players online now and the record, how many people play, when the community
 * plays, the live feed of arrivals, the most active players of the week and the month, and the servers by players.
 */
import { useState } from 'react';
import { busiestText, FeedItem, MiniHeat, useCommunity } from '../components/servers/CommunityBento';
import { AnimatedNumber, GameAvatar, PageHead, fmtDateTime, plural } from '../ui';
import '../styles/analytics.css';
import '../styles/community.css';

const IconPeople = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <circle cx="9" cy="8" r="3.2" /><path d="M3 20c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5" /><circle cx="17" cy="9" r="2.4" /><path d="M16.5 14.6c2.6.2 4.5 2 4.5 4.9" />
  </svg>
);

export default function CommunityPage() {
  const c = useCommunity();
  const [period, setPeriod] = useState<'week' | 'month'>('week');
  if (!c) {
    return (
      <div className="space-y-5" aria-busy="true">
        <PageHead icon={<IconPeople />} title="Сообщество" subtitle="Кто играет, когда и где" />
        <div className="tile skeleton h-56" />
        <div className="tile skeleton h-72" />
      </div>
    );
  }
  const top = c.top[period];
  const maxH = Math.max(1, ...top.map((p) => p.hours));
  const maxP = Math.max(1, ...c.servers.map((s) => s.players));
  return (
    <div className="space-y-5">
      <PageHead icon={<IconPeople />} title="Сообщество" subtitle="Кто играет, когда и где: живые цифры всех серверов" />

      <section className="tile cm-hero fade-in">
        <div className="cm-hero-main">
          <div className="cm-k">Сейчас в игре</div>
          <div className="flex items-baseline gap-3">
            <AnimatedNumber value={c.now.players} className="cm-hero-n" pulse />
            <span className="text-lg font-extrabold text-mute">{plural(c.now.players, ['игрок', 'игрока', 'игроков'])} на {c.now.online} {plural(c.now.online, ['сервере', 'серверах', 'серверах'])}</span>
          </div>
          {c.record && <p className="cm-sub">Рекорд за 30 дней: <b className="text-ink">{c.record.players}</b>, {fmtDateTime(c.record.at)}</p>}
        </div>
        <dl className="cm-hero-stats">
          <div><dt>За сутки</dt><dd>{c.players.day}</dd></div>
          <div><dt>За неделю</dt><dd>{c.players.week}</dd></div>
          <div><dt>За месяц</dt><dd>{c.players.month}</dd></div>
          <div><dt>Новых за неделю</dt><dd>{c.players.newWeek}</dd></div>
        </dl>
      </section>

      <section className="tile p-4 sm:p-5">
        <h2 className="mb-3 text-lg font-extrabold">Когда играет сообщество</h2>
        <MiniHeat cells={c.heatmap.cells} big />
        <p className="cm-sub">{busiestText(c.heatmap.busiest)}. Средние за 30 дней по всем серверам.</p>
      </section>

      <div className="grid gap-5 lg:grid-cols-2">
        <section className="tile p-4 sm:p-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-extrabold">Самые активные</h2>
            <div className="seg" role="group" aria-label="Период">
              <button type="button" className="seg-item" aria-pressed={period === 'week'} onClick={() => setPeriod('week')}>Неделя</button>
              <button type="button" className="seg-item" aria-pressed={period === 'month'} onClick={() => setPeriod('month')}>Месяц</button>
            </div>
          </div>
          {top.length === 0 ? <p className="cm-sub">Пока никто не играл.</p> : (
            <ol className="an-top">
              {top.map((p, i) => (
                <li key={p.name}>
                  <span className={`an-top-n ${i < 3 ? `is-${i + 1}` : ''}`}>{i + 1}</span>
                  <span className="min-w-0 flex-1">
                    <a href={`/player/${encodeURIComponent(p.name)}`} className="block truncate font-extrabold hover:text-link">{p.name}</a>
                    <span className="an-top-bar"><span style={{ width: `${(p.hours / maxH) * 100}%`, background: 'rgb(var(--brand))' }} /></span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="block font-extrabold tabular-nums">{p.hours} ч</span>
                    <span className="block text-xs font-bold text-mute">{p.servers} {plural(p.servers, ['сервер', 'сервера', 'серверов'])}</span>
                  </span>
                </li>
              ))}
            </ol>
          )}
        </section>

        <section className="tile p-4 sm:p-5">
          <h2 className="mb-3 text-lg font-extrabold">Живая лента</h2>
          {c.feed.length ? <ul className="cm-feed-list">{c.feed.map((f) => <FeedItem key={`${f.name}-${f.at}`} f={f} />)}</ul> : <p className="cm-sub">Пока никто не заходил.</p>}
        </section>
      </div>

      <section className="tile p-4 sm:p-5">
        <h2 className="mb-3 text-lg font-extrabold">Где играют сейчас</h2>
        <ul className="grid gap-2.5">
          {c.servers.map((s) => (
            <li key={s.id}>
              <a href={`/servers/${s.id}`} className="cm-srv">
                <GameAvatar game={s.game} size={36} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-extrabold">{s.name}</span>
                  <span className="cm-srv-bar"><span style={{ width: `${(s.players / maxP) * 100}%` }} /></span>
                </span>
                <span className="shrink-0 text-right font-extrabold tabular-nums">{s.online ? `${s.players}${s.maxPlayers ? ` / ${s.maxPlayers}` : ''}` : <span className="text-bad">не в сети</span>}</span>
              </a>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
