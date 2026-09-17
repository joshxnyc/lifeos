// Route-level skeleton: Next shows this the moment a navigation starts, while
// the page's server data is still loading — so a tap answers instantly even
// when Supabase is slow. Shape mirrors the common screen anatomy (title bar,
// then hairline-separated rows); the pulse is plain CSS (globals.css
// .skeleton-block) and holds still under reduced motion.
const ROW_WIDTHS = ["w-3/5", "w-2/5", "w-1/2", "w-2/3", "w-2/5", "w-1/2"];

export default function Loading() {
  return (
    <div role="status" aria-label="Loading" className="pt-6">
      <div className="skeleton-block h-8 w-44 md:h-10 md:w-56" />
      <div className="skeleton-block mt-2.5 h-3.5 w-28" />
      <div className="mt-8">
        {ROW_WIDTHS.map((width, i) => (
          <div key={i} className="flex min-h-11 items-center gap-3 border-b border-line py-3.5">
            <div className="skeleton-block size-[18px] shrink-0 rounded-full" />
            <div className={`skeleton-block h-3.5 ${width}`} />
          </div>
        ))}
      </div>
    </div>
  );
}
