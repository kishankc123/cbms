export function PayrollPlaceholder({ title }: { title: string }) {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold text-gray-900">{title}</h1>
      <div className="rounded-lg border border-dashed border-gray-300 bg-white p-8 text-center text-sm text-gray-500">
        {title} is not built yet — coming soon.
      </div>
    </div>
  );
}
