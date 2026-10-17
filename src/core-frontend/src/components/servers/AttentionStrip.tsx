// A compact strip for servers that need a look (not answering, or a high ping): one line each, above the tiles.
import type { Server } from '../../api';
import { t } from '../../i18n';
import { LAG_PING, ago } from '../../ui';

const MAX_ROWS = 4;

function reasonOf(s: Server): string {
  if (!s.online) return `${t('srv.pulse.noAnswer')}${s.updatedAt ? ` · ${t('srv.attn.last', { ago: ago(s.updatedAt) })}` : ''}`;
  return `${t('srv.pulse.slow')} · ${s.ping ?? LAG_PING} ${t('srv.unit.ms')}`;
}

export function AttentionStrip({ servers, onOpen }: { servers: Server[]; onOpen: (s: Server) => void }) {
  if (servers.length === 0) return null;
  const shown = servers.slice(0, MAX_ROWS);
  const more = servers.length - shown.length;
  return (
    <section className="attn" aria-label={t('srv.attn.title')}>
      <h2 className="attn-h">{t('srv.attn.title')}</h2>
      <ul className="attn-list">
        {shown.map((s) => (
          <li key={s.id}>
            <a
              className={`attn-row ${s.online ? 'is-warn' : 'is-bad'}`}
              href={`/servers/${s.id}`}
              onClick={(e) => {
                if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
                e.preventDefault();
                onOpen(s);
              }}
            >
              <span className="attn-dot" aria-hidden />
              <span className="attn-name">{s.name}</span>
              <span className="attn-why">{reasonOf(s)}</span>
              <span className="attn-go" aria-hidden>→</span>
            </a>
          </li>
        ))}
      </ul>
      {more > 0 && <p className="attn-more">{t('srv.attn.more', { n: more })}</p>}
    </section>
  );
}
