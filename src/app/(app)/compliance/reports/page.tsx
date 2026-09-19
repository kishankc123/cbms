import { ReportsViewer } from "./reports-viewer";

export default function ReportsPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold text-gray-900">Compliance Reports</h1>
      <ReportsViewer />
    </div>
  );
}
