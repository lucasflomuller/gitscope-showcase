import Workspace from "./workspace";

export const dynamic = "force-dynamic";

export default function Page() {
  const demo = process.env.GITSCOPE_DEMO === "1";
  return (
    <div className="flex h-full min-h-0 flex-col">
      {demo && (
        <aside aria-label="Demo mode" className="flex flex-wrap items-center justify-center gap-x-3 border-b border-sky-200 bg-sky-50 px-4 py-2 text-xs text-sky-950 dark:border-sky-900 dark:bg-sky-950 dark:text-sky-100">
          <strong>Synthetic demo</strong>
          <span>Explore Atlas Metrics and Signal Pipeline. Read-only; no accounts or AI calls.</span>
        </aside>
      )}
      <div className="min-h-0 flex-1"><Workspace /></div>
    </div>
  );
}
