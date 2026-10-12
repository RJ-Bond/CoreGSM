import { connectGuide } from '../../connectGuides';
import { CopyButton } from '../../ui';

/** «Подключение»: numbered steps for the game, copyable values and a one-click link where the game has a protocol */
export default function ConnectTab({ game, address }: { game: string; address: string }) {
  const guide = connectGuide(game, address);
  return (
    <div className="grid gap-3.5 lg:grid-cols-12">
      <section className="tile tile-in p-5 lg:col-span-7" style={{ ['--i' as string]: 0 }}>
        <h2 className="mb-4 text-lg font-extrabold">{guide.title}</h2>
        <ol className="space-y-3">
          {guide.steps.map((s, i) => (
            <li key={i} className="flex gap-3">
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-soft text-sm font-extrabold text-link" aria-hidden>{i + 1}</span>
              <p className="min-w-0 break-words pt-0.5 font-semibold leading-snug">{s}</p>
            </li>
          ))}
        </ol>
        {guide.link && (
          <a href={guide.link.href} className="btn mt-5 w-full sm:w-auto" data-magnetic>{guide.link.label}</a>
        )}
      </section>
      <section className="tile tile-in p-5 lg:col-span-5" style={{ ['--i' as string]: 1 }}>
        <h2 className="mb-3 text-base font-extrabold">Что понадобится</h2>
        <ul className="space-y-2.5">
          {guide.copy.map((c) => (
            <li key={c.label} className="min-w-0">
              <div className="mb-1 text-[13px] font-extrabold text-mute">{c.label}</div>
              <div className="flex items-center gap-2">
                <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap rounded-xl bg-soft px-3 py-2 font-mono text-sm font-semibold">{c.value}</code>
                <CopyButton text={c.value} label="Копировать" />
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
