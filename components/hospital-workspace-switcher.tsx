"use client";

import { useEffect, useState } from "react";
import { Building2, ChevronDown } from "lucide-react";
import { SELECTED_HOSPITAL_STORAGE_KEY } from "@/lib/client/hospital-workspace";

type Workspace = {
  id: string;
  name: string;
  status: string;
  city: string | null;
  country: string;
  role: string;
};

export default function HospitalWorkspaceSwitcher() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    async function loadWorkspaces() {
      try {
        const response = await fetch("/api/hospital/workspaces", { cache: "no-store" });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error ?? "Unable to load hospital workspaces.");
        const available = (payload.workspaces ?? []) as Workspace[];
        if (!active) return;
        setWorkspaces(available);

        const urlId = new URLSearchParams(window.location.search).get("hospitalId") ?? "";
        const storedId = window.localStorage.getItem(SELECTED_HOSPITAL_STORAGE_KEY) ?? "";
        const chosen = available.find(item => item.id === urlId)
          ?? available.find(item => item.id === storedId)
          ?? available.find(item => item.status === "active")
          ?? available[0];

        if (!chosen) {
          window.localStorage.removeItem(SELECTED_HOSPITAL_STORAGE_KEY);
          setSelectedId("");
          return;
        }

        setSelectedId(chosen.id);
        window.localStorage.setItem(SELECTED_HOSPITAL_STORAGE_KEY, chosen.id);
        if (urlId !== chosen.id) {
          const url = new URL(window.location.href);
          url.searchParams.set("hospitalId", chosen.id);
          window.location.replace(`${url.pathname}${url.search}${url.hash}`);
          return;
        }
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : "Unable to load hospital workspaces.");
      } finally {
        if (active) setLoading(false);
      }
    }
    void loadWorkspaces();
    return () => { active = false; };
  }, []);

  function changeWorkspace(nextId: string) {
    const chosen = workspaces.find(item => item.id === nextId);
    if (!chosen) return;
    window.localStorage.setItem(SELECTED_HOSPITAL_STORAGE_KEY, chosen.id);
    setSelectedId(chosen.id);
    const url = new URL(window.location.href);
    url.searchParams.set("hospitalId", chosen.id);
    window.location.assign(`${url.pathname}${url.search}${url.hash}`);
  }

  const selected = workspaces.find(item => item.id === selectedId);

  return (
    <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "10px 24px 2px" }}>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 7, color: "var(--muted, #82918a)", fontSize: 10, fontWeight: 700, letterSpacing: "0.11em", textTransform: "uppercase" }}>
        <Building2 size={14} /> Hospital workspace
      </span>
      {loading ? <span style={{ color: "var(--muted, #82918a)", fontSize: 12 }}>Loading…</span> :
        error ? <span role="alert" style={{ color: "#e3a6a6", fontSize: 12 }}>{error}</span> :
        workspaces.length > 1 ? <div style={{ position: "relative", minWidth: 210, maxWidth: "100%" }}>
          <select aria-label="Switch hospital workspace" value={selectedId} onChange={event => changeWorkspace(event.target.value)} style={{ appearance: "none", width: "100%", border: "1px solid rgba(164,237,193,.22)", borderRadius: 9, padding: "10px 34px 10px 12px", background: "#101917", color: "#e7f0eb", fontSize: 12, outlineOffset: 2 }}>
            {workspaces.map(item => <option key={item.id} value={item.id}>{item.name} · {item.role.replaceAll("_", " ")}</option>)}
          </select>
          <ChevronDown size={15} aria-hidden="true" style={{ position: "absolute", right: 11, top: "50%", transform: "translateY(-50%)", pointerEvents: "none", color: "#a4edc1" }} />
        </div> :
        selected ? <span style={{ color: "#e7f0eb", fontSize: 12 }}>{selected.name} · {selected.role.replaceAll("_", " ")}</span> :
        <span style={{ color: "var(--muted, #82918a)", fontSize: 12 }}>No hospital membership</span>}
    </div>
  );
}
