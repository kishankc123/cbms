"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { runScan, updateException, type listExceptions, type listAssignableUsers } from "../actions";

type Exception = Awaited<ReturnType<typeof listExceptions>>[number];
type AssignableUser = Awaited<ReturnType<typeof listAssignableUsers>>[number];

const STATUS_FLOW = ["open", "assigned", "under_review", "resolved", "closed"] as const;

export function ExceptionsTable({ exceptions, assignableUsers }: { exceptions: Exception[]; assignableUsers: AssignableUser[] }) {
  const router = useRouter();
  const [scanning, setScanning] = useState(false);
  const [scanMessage, setScanMessage] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [resolutionText, setResolutionText] = useState("");

  async function handleScan() {
    setScanning(true);
    setScanMessage(null);
    try {
      const created = await runScan();
      setScanMessage(created > 0 ? `Found ${created} new exception${created === 1 ? "" : "s"}.` : "No new exceptions found.");
      router.refresh();
    } finally {
      setScanning(false);
    }
  }

  async function handleAssign(id: string, userId: string) {
    setBusyId(id);
    try {
      await updateException({ exceptionId: id, assignedUserId: userId || null, status: userId ? "assigned" : undefined });
      router.refresh();
    } finally {
      setBusyId(null);
    }
  }

  async function handleStatus(id: string, status: (typeof STATUS_FLOW)[number]) {
    if (status === "resolved") {
      setResolvingId(id);
      return;
    }
    setBusyId(id);
    try {
      await updateException({ exceptionId: id, status });
      router.refresh();
    } finally {
      setBusyId(null);
    }
  }

  async function handleResolve() {
    if (!resolvingId) return;
    setBusyId(resolvingId);
    try {
      await updateException({ exceptionId: resolvingId, status: "resolved", resolution: resolutionText });
      setResolvingId(null);
      setResolutionText("");
      router.refresh();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-end gap-3">
        {scanMessage && <span className="text-xs text-gray-500">{scanMessage}</span>}
        <button type="button" disabled={scanning} onClick={handleScan} className="rounded bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white text-sm px-4 py-1.5 disabled:opacity-50">
          {scanning ? "Scanning..." : "Run Scan"}
        </button>
      </div>

      <table className="w-full text-sm bg-white border border-gray-200 rounded-lg overflow-hidden">
        <thead className="bg-gray-50 text-left text-gray-500">
          <tr>
            <th className="px-4 py-2 font-medium">Type</th>
            <th className="px-4 py-2 font-medium">Description</th>
            <th className="px-4 py-2 font-medium">Severity</th>
            <th className="px-4 py-2 font-medium">Detected</th>
            <th className="px-4 py-2 font-medium">Assigned</th>
            <th className="px-4 py-2 font-medium">Status</th>
            <th className="px-4 py-2 font-medium"></th>
          </tr>
        </thead>
        <tbody>
          {exceptions.map((e) => (
            <tr key={e.id} className="border-t border-gray-100">
              <td className="px-4 py-2 capitalize">{e.exceptionType.replace(/_/g, " ")}</td>
              <td className="px-4 py-2 max-w-[280px] truncate">{e.description}</td>
              <td className="px-4 py-2 capitalize">{e.severity.replace("_", " ")}</td>
              <td className="px-4 py-2">{new Date(e.detectedDate).toLocaleDateString()}</td>
              <td className="px-4 py-2">
                <select
                  value={e.assignedUserId ?? ""}
                  disabled={busyId === e.id || e.status === "closed"}
                  onChange={(ev) => handleAssign(e.id, ev.target.value)}
                  className="rounded border border-gray-300 px-1.5 py-1 text-xs"
                >
                  <option value="">Unassigned</option>
                  {assignableUsers.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </select>
              </td>
              <td className="px-4 py-2">
                <select
                  value={e.status}
                  disabled={busyId === e.id || e.status === "closed"}
                  onChange={(ev) => handleStatus(e.id, ev.target.value as (typeof STATUS_FLOW)[number])}
                  className="rounded border border-gray-300 px-1.5 py-1 text-xs capitalize"
                >
                  {STATUS_FLOW.map((s) => (
                    <option key={s} value={s}>
                      {s.replace("_", " ")}
                    </option>
                  ))}
                </select>
              </td>
              <td className="px-4 py-2 text-xs text-gray-400 max-w-[160px] truncate" title={e.resolution ?? undefined}>
                {e.resolution ?? ""}
              </td>
            </tr>
          ))}
          {exceptions.length === 0 && (
            <tr>
              <td colSpan={7} className="px-4 py-6 text-center text-gray-400">
                No exceptions — run a scan to check for issues
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {resolvingId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/30" onClick={() => setResolvingId(null)} />
          <div className="relative w-full max-w-sm rounded-lg bg-white p-5 shadow-lg space-y-3">
            <h2 className="text-base font-semibold text-gray-900">Resolve exception</h2>
            <textarea value={resolutionText} onChange={(e) => setResolutionText(e.target.value)} rows={3} placeholder="Resolution notes" className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm" />
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setResolvingId(null)} className="rounded px-4 py-1.5 text-sm text-gray-600 hover:bg-gray-100">
                Cancel
              </button>
              <button type="button" onClick={handleResolve} className="rounded bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white text-sm px-4 py-1.5">
                Resolve
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
