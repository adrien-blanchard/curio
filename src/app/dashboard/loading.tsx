export default function DashboardLoading() {
  return (
    <div className="flex h-[calc(100vh-100px)] w-full items-center justify-center bg-transparent backdrop-blur-sm">
      <div className="flex flex-col items-center gap-4">
        <div className="w-10 h-10 rounded-full border-4 border-primary/20 border-t-primary animate-spin"></div>
        <p className="text-sm font-medium text-slate-500 animate-pulse">Loading data...</p>
      </div>
    </div>
  );
}
