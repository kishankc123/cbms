"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/field";
import { useProblem } from "@/components/problem-dialog";
import { BankLogo } from "@/components/bank-logo";
import { KIND_LABEL, type Institution, type InstitutionKind } from "@/lib/banking/institution-rules";
import { loadStartingBanks, saveBank, setBankLogo, setBankLogos } from "./actions";

const toBase64 = (file: File) =>
  new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.readAsDataURL(file);
  });
const asFile = async (f: File) => ({ name: f.name, type: f.type, base64: await toBase64(f) });

export function BanksAdmin({ countryCode, countries, list }: { countryCode: string; countries: { code: string; name: string }[]; list: Institution[] }) {
  const router = useRouter();
  const { report, dialog } = useProblem();
  const [name, setName] = useState("");
  const [kind, setKind] = useState<InstitutionKind>("bank");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const bulk = useRef<HTMLInputElement>(null);
  const one = useRef<HTMLInputElement>(null);
  const forId = useRef("");

  // Runs one change, then shows what it said if it was refused.
  async function run<T extends { ok?: boolean; error?: string }>(work: () => Promise<T>) {
    setBusy(true);
    try {
      const r = await work();
      if (r.ok === false) report(r.error ?? "That did not work.", null);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }
  const save = (i: Institution, patch: Partial<Pick<Institution, "name" | "code" | "kind" | "isActive">>) => run(() => saveBank({ id: i.id, countryCode, name: i.name, code: i.code, kind: i.kind, isActive: i.isActive, ...patch }));

  async function bulkLogos(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    const r = await setBankLogos(countryCode, await Promise.all([...files].map(asFile)));
    setMessage(`${r.done.length} logo${r.done.length === 1 ? "" : "s"} added.${r.skipped.length ? ` Not used: ${r.skipped.join(", ")} (no single bank or wallet matches the file name, or the file is not a usable picture).` : ""}`);
    setBusy(false);
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {countries.length > 1 && (
          <Select className="!w-48" value={countryCode} onChange={(e) => router.push(`/admin/banks?country=${e.target.value}`)}>
            {countries.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
              </option>
            ))}
          </Select>
        )}
        {list.length === 0 && (
          <Button size="sm" loading={busy} onClick={() => run(async () => ({ ok: (await loadStartingBanks(countryCode)) > 0 }))}>
            Load the starting list
          </Button>
        )}
        <Button size="sm" icon={<Upload size={15} />} disabled={busy || list.length === 0} onClick={() => bulk.current?.click()}>
          Upload logos
        </Button>
        <span className="text-xs text-ink-2">Name each file after the bank's code, for example nabil.svg or esewa.png. PNG, JPEG, WebP or SVG, up to 40 KB.</span>
        <input ref={bulk} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" multiple hidden onChange={(e) => bulkLogos(e.target.files).then(() => (e.target.value = ""))} />
        <input
          ref={one}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/svg+xml"
          hidden
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) await run(async () => setBankLogo(forId.current, await asFile(f)));
          }}
        />
      </div>
      {message && <p className="text-sm text-ink-2">{message}</p>}

      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          run(() => saveBank({ countryCode, name, kind, isActive: true })).then(() => setName(""));
        }}
      >
        <Input className="!w-64" value={name} onChange={(e) => setName(e.target.value)} placeholder="Add a bank or wallet" maxLength={80} />
        <Select className="!w-32" value={kind} onChange={(e) => setKind(e.target.value as InstitutionKind)}>
          <option value="bank">Bank</option>
          <option value="wallet">Wallet</option>
        </Select>
        <Button size="sm" type="submit" loading={busy} disabled={!name.trim()}>
          Add
        </Button>
      </form>

      <table className="w-full border-collapse text-[13px]">
        <thead className="text-left text-xs text-ink-2 [&_th]:border-b [&_th]:border-line [&_th]:bg-app [&_th]:px-2.5 [&_th]:py-1.5 [&_th]:font-medium">
          <tr>
            <th>Name</th>
            <th>Code</th>
            <th>Type</th>
            <th>Shown</th>
            <th>Logo</th>
          </tr>
        </thead>
        <tbody>
          {list.map((i) => (
            <tr key={i.id} className={`border-b border-line ${i.isActive ? "" : "text-ink-3"}`}>
              <td className="px-2.5 py-1.5">
                <div className="flex items-center gap-2">
                  <BankLogo name={i.name} institution={i} />
                  <Input defaultValue={i.name} maxLength={80} className="!w-64" onBlur={(e) => e.target.value.trim() !== i.name && save(i, { name: e.target.value })} />
                </div>
              </td>
              <td className="px-2.5 py-1.5">
                <Input defaultValue={i.code ?? ""} maxLength={12} className="!w-28 uppercase" aria-label={`Code of ${i.name}`} onBlur={(e) => e.target.value.trim().toUpperCase() !== (i.code ?? "") && save(i, { code: e.target.value })} />
              </td>
              <td className="px-2.5 py-1.5">
                <Select className="!w-28" value={i.kind} onChange={(e) => save(i, { kind: e.target.value as InstitutionKind })}>
                  {(Object.keys(KIND_LABEL) as InstitutionKind[]).map((k) => (
                    <option key={k} value={k}>
                      {KIND_LABEL[k].replace(/s$/, "")}
                    </option>
                  ))}
                </Select>
              </td>
              <td className="px-2.5 py-1.5">
                <input type="checkbox" checked={i.isActive} onChange={(e) => save(i, { isActive: e.target.checked })} aria-label={`Show ${i.name}`} />
              </td>
              <td className="px-2.5 py-1.5">
                <div className="flex gap-1.5">
                  <Button size="sm" disabled={busy} onClick={() => ((forId.current = i.id), one.current?.click())}>
                    {i.hasLogo ? "Replace" : "Upload"}
                  </Button>
                  {i.hasLogo && <Button size="sm" icon={<Trash2 size={14} />} disabled={busy} onClick={() => run(() => setBankLogo(i.id, null))} aria-label={`Remove the logo of ${i.name}`} />}
                </div>
              </td>
            </tr>
          ))}
          {list.length === 0 && (
            <tr>
              <td colSpan={5} className="px-2.5 py-6 text-center text-ink-2">
                Nothing in the list yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      {dialog}
    </div>
  );
}
