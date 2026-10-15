import { IconArrow } from '../ui';
import { NotFoundArt } from './Illustrations';
import { StateView } from './StateView';

/** Unknown route or unknown server id. `kind` only changes the wording; both buttons are always there. */
export default function NotFound({ kind = 'page' }: { kind?: 'page' | 'server' }) {
  return (
    <StateView
      kind="notfound"
      heading="h1"
      className="mx-auto max-w-xl !gap-3 sm:!py-14"
      art={(
        <>
          <NotFoundArt />
          <p className="nf-code text-6xl font-black leading-none tracking-[-0.05em] sm:text-7xl" aria-hidden>404</p>
        </>
      )}
      title={kind === 'server' ? 'Сервер не найден' : 'Такой страницы нет'}
      text={kind === 'server'
        ? 'Возможно, его удалили или ссылка устарела. Откройте список серверов и найдите нужный.'
        : 'Ссылка устарела или в адресе опечатка. Вернитесь на главную: всё самое нужное там.'}
    >
      <a className="btn" href="/" data-magnetic>
        На главную
        <IconArrow />
      </a>
      <a className="btn btn-soft" href="/servers">К серверам</a>
    </StateView>
  );
}
