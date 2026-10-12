import { IconArrow } from '../ui';
import { NotFoundArt } from './Illustrations';

/** Unknown route or unknown server id. `kind` only changes the wording; both buttons are always there. */
export default function NotFound({ kind = 'page' }: { kind?: 'page' | 'server' }) {
  return (
    <div className="panel fade-in mx-auto flex max-w-xl flex-col items-center gap-3 px-6 py-10 text-center sm:py-14" role="region" aria-labelledby="nf-title">
      <NotFoundArt />
      <p className="nf-code text-6xl font-black leading-none tracking-[-0.05em] sm:text-7xl" aria-hidden>404</p>
      <h1 id="nf-title" className="text-2xl font-extrabold tracking-[-0.02em]">
        {kind === 'server' ? 'Сервер не найден' : 'Такой страницы нет'}
      </h1>
      <p className="max-w-sm font-semibold text-mute">
        {kind === 'server'
          ? 'Возможно, его удалили или ссылка устарела. Откройте список серверов и найдите нужный.'
          : 'Ссылка устарела или в адресе опечатка. Вернитесь на главную: всё самое нужное там.'}
      </p>
      <div className="mt-3 flex flex-wrap justify-center gap-2.5">
        <a className="btn" href="#/" data-magnetic>
          На главную
          <IconArrow />
        </a>
        <a className="btn btn-soft" href="#/servers">К серверам</a>
      </div>
    </div>
  );
}
