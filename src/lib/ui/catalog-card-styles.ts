/** Shared presentation primitives for the public demo and private catalogue. */
export const catalogCardStyles = {
  card: "group relative flex h-full flex-col overflow-hidden rounded-3xl border border-slate-100 bg-white shadow-[0_8px_30px_rgba(15,23,42,0.04)] transition-[transform,border-color,box-shadow] duration-200 hover:-translate-y-1 hover:border-blue-200 hover:shadow-[0_18px_40px_rgba(0,117,201,0.10)] focus-within:-translate-y-1 focus-within:border-blue-200 focus-within:shadow-[0_18px_40px_rgba(0,117,201,0.10)] motion-reduce:transform-none motion-reduce:transition-none",
  media: "relative aspect-[21/9] shrink-0 overflow-hidden bg-slate-50",
  image:
    "h-full w-full object-cover transition duration-300 group-hover:scale-[1.03] motion-reduce:transform-none motion-reduce:transition-none",
  sourceBadge:
    "absolute left-4 top-4 rounded-xl bg-slate-950/75 px-3 py-1.5 text-[10px] font-extrabold uppercase tracking-[0.13em] text-white backdrop-blur",
  body: "flex min-h-56 flex-1 flex-col p-5",
  date: "text-xs font-bold uppercase tracking-[0.12em] text-slate-500",
  title: "line-clamp-2 min-h-[3rem] text-lg font-extrabold leading-snug text-[#1B254B]",
  summary: "mt-3 h-[4.3rem] line-clamp-3 text-sm font-medium leading-relaxed text-slate-500",
  tag: "rounded-lg px-2.5 py-1 text-xs font-bold",
} as const;
