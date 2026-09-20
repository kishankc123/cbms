import { useCallback, useMemo, useState } from "react";

/**
 * A dropdown's options plus any record just created from the "Add new" button. The server list
 * only catches up after a refresh, so the new record is kept locally and shown immediately
 * (and dropped from the local list once the server list contains it).
 */
export function useWithAdded<T extends { id: string }>(base: T[]): [T[], (item: T) => void] {
  const [added, setAdded] = useState<T[]>([]);
  const list = useMemo(() => {
    const ids = new Set(base.map((b) => b.id));
    return [...base, ...added.filter((a) => !ids.has(a.id))];
  }, [base, added]);
  const add = useCallback((item: T) => setAdded((prev) => (prev.some((p) => p.id === item.id) ? prev : [...prev, item])), []);
  return [list, add];
}
