import { getSourceAge, SOURCE_DATE_LABELS, type SourceDateKind } from "@/lib/ui/source-age";

const appearance = {
  recent: { label: "< 3 months", color: "bg-emerald-50 text-emerald-800", dot: "bg-emerald-500" },
  established: { label: "3–6 months", color: "bg-amber-50 text-amber-900", dot: "bg-amber-500" },
  older: { label: "6+ months", color: "bg-slate-100 text-slate-600", dot: "bg-slate-400" },
  unknown: { label: "Date unknown", color: "bg-slate-100 text-slate-500", dot: "bg-slate-300" },
};

export default function SourceAgeBadge({
  date,
  kind,
  now,
}: {
  date?: string | null;
  kind?: SourceDateKind | null;
  now?: Date;
}) {
  const age = getSourceAge(date, now);
  const style = appearance[age];
  const explanation =
    age === "unknown"
      ? "No reliable source date is available."
      : `${kind ? SOURCE_DATE_LABELS[kind] : "Source"} date: ${date}. Age is context, not a quality score.`;
  return (
    <span
      title={explanation}
      aria-label={`Source age: ${style.label}. ${explanation}`}
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold leading-4 ${style.color}`}
    >
      <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${style.dot}`} />
      {style.label}
    </span>
  );
}
