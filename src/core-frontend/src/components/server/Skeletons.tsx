import type { TabId } from './helpers';

const sk = 'skeleton tile';

export function BannerSkeleton() {
  return <div className={`${sk} h-[300px] sm:h-[250px]`} />;
}

export function TabBarSkeleton() {
  return <div className="skeleton h-[44px] w-full max-w-[26rem] rounded-full sm:h-[38px]" />;
}

/** the same blocks as the loaded tab, so nothing jumps when the data arrives */
export function TabSkeleton({ tab }: { tab: TabId }) {
  if (tab === 'players') {
    return (
      <div className={`${sk} p-5`}>
        <div className="skeleton skel-line mb-4 !h-6 w-40" />
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="flex items-center gap-3 py-2">
            <div className="skeleton h-9 w-9 rounded-xl" />
            <div className="skeleton skel-line !h-4 flex-1" />
            <div className="skeleton skel-line !h-4 w-16" />
          </div>
        ))}
      </div>
    );
  }
  if (tab === 'history') {
    return (
      <div className="space-y-3.5">
        <div className={`${sk} h-[390px]`} />
        <div className="grid grid-cols-2 gap-3.5 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => <div key={i} className={`${sk} h-[106px]`} />)}
        </div>
      </div>
    );
  }
  if (tab === 'events') return <div className={`${sk} h-[360px]`} />;
  if (tab === 'connect') {
    return (
      <div className="grid gap-3.5 lg:grid-cols-12">
        <div className={`${sk} h-[360px] lg:col-span-7`} />
        <div className={`${sk} h-[220px] lg:col-span-5`} />
      </div>
    );
  }
  return (
    <div className="space-y-3.5">
      <div className="grid grid-cols-2 gap-3.5 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => <div key={i} className={`${sk} h-[132px]`} />)}
      </div>
      <div className="grid gap-3.5 lg:grid-cols-12">
        <div className={`${sk} h-[380px] lg:col-span-8`} />
        <div className={`${sk} h-[380px] lg:col-span-4`} />
        <div className={`${sk} h-52 lg:col-span-8`} />
        <div className={`${sk} h-52 lg:col-span-4`} />
      </div>
    </div>
  );
}
