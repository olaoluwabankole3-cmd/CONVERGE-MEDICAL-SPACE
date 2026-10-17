"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, CalendarDays, CheckCircle2, Clock3, Plus, RefreshCw, Search, ShieldCheck, Users, X, Save } from "lucide-react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

type WorkType = "access_case" | "appointment" | "follow_up" | "exception" | "task";
type Priority = "low" | "medium" | "high" | "urgent";
type WorkStatus = "draft" | "open" | "needs_review" | "in_progress" | "awaiting_response" | "resolved" | "closed";
type PatientReference = { id: string; reference_code: string; care_area: string | null; status: "active" | "archived" };
type Row = { id: string; reference_code: string; title: string; summary: string | null; item_type: WorkType; priority: Priority; status: WorkStatus; owner_id: string | null; external_reference: string | null; due_at: string | null; patient_record_id: string | null; created_at: string; updated_at: string };
const labels: Record<WorkType,string> = { access_case: "Access case", appointment: "Appointment", follow_up: "Follow-up", exception: "Exception", task: "Task" };
const statusLabels: Record<string,string> = { draft: "Draft", open: "Open", needs_review: "Needs review", in_progress: "In progress", awaiting_response: "Awaiting response", resolved: "Resolved", closed: "Closed" };
const titles: Record<string,string> = { access_case: "Access cases", appointment: "Appointments", follow_up: "Follow-ups & tasks", exception: "Exceptions", task: "Follow-ups & tasks" };
const descriptions: Record<string,string> = { access_case: "Coordinate and track operational access requests.", appointment: "Review appointment-related operational work.", follow_up: "Track outstanding follow-ups and operational tasks.", exception: "Review exceptions that need operational attention.", task: "Track outstanding operational tasks." };
const validTypes: WorkType[] = ["access_case", "appointment", "follow_up", "exception", "task"];
const validStatuses: WorkStatus[] = ["draft", "open", "needs_review", "in_progress", "awaiting_response", "resolved", "closed"];
const validPriorities: Priority[] = ["low", "medium", "high", "urgent"];

export default function WorkPage() {
  const router = useRouter();
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);
  const [type, setType] = useState<WorkType>("access_case");
  const [items, setItems] = useState<Row[]>([]);
  const [patientReferences, setPatientReferences] = useState<PatientReference[]>([]);
  const [newPatientRecordId, setNewPatientRecordId] = useState("");
  const [hospitalId, setHospitalId] = useState("");
  const [hospitalName, setHospitalName] = useState("");
  const [userId, setUserId] = useState("");
  const [role, setRole] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("open");
  const [showCreate, setShowCreate] = useState(false);
  const [newReference, setNewReference] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [newSummary, setNewSummary] = useState("");
  const [newExternalReference, setNewExternalReference] = useState("");
  const [newPriority, setNewPriority] = useState<Priority>("medium");
  const [newStatus, setNewStatus] = useState<WorkStatus>("open");
  const [newDueAt, setNewDueAt] = useState("");
  const [changingId, setChangingId] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const value = params.get("type") ?? "access_case";
    if (validTypes.includes(value as WorkType)) setType(value as WorkType);
    const requestedStatus = params.get("status");
    if (requestedStatus && ["all", ...validStatuses].includes(requestedStatus)) setStatus(requestedStatus);
  }, []);

  const load = useCallback(async () => {
    if (!supabase) { setError("Supabase is not configured for this deployment."); setLoading(false); return; }
    setLoading(true); setError("");
    try {
      const { data: auth, error: authError } = await supabase.auth.getUser();
      if (authError || !auth.user) { router.replace("/login"); return; }
      setUserId(auth.user.id);
      const { data: memberships, error: memberError } = await supabase.from("hospital_memberships").select("hospital_id,role,created_at").order("created_at", { ascending: false }).limit(10);
      if (memberError) throw memberError;
      let selected: { hospital_id: string; role: string } | null = null;
      for (const membership of memberships ?? []) {
        const { data: candidate, error: hospitalError } = await supabase.from("hospitals").select("id,name,status").eq("id", membership.hospital_id).maybeSingle();
        if (hospitalError) throw hospitalError;
        if (candidate?.status === "active") {
          selected = { hospital_id: membership.hospital_id, role: membership.role };
          setHospitalId(membership.hospital_id); setHospitalName(candidate.name); setRole(membership.role);
          break;
        }
      }
      if (!selected) {
        const { data: owned, error: ownedError } = await supabase.from("hospitals").select("id,name,status").eq("created_by", auth.user.id).order("created_at", { ascending: false }).limit(1).maybeSingle();
        if (ownedError) throw ownedError;
        if (owned && owned.status !== "active") throw new Error("This hospital workspace must be approved before operational records are available.");
        throw new Error("No active hospital membership was found for this account.");
      }
      const [{ data, error: itemsError }, { data: refs, error: refsError }] = await Promise.all([
        supabase.from("work_items").select("id,reference_code,title,summary,item_type,priority,status,owner_id,external_reference,due_at,patient_record_id,created_at,updated_at").eq("hospital_id", selected.hospital_id).eq("item_type", type).order("updated_at", { ascending: false }).limit(200),
        supabase.from("patient_records").select("id,reference_code,care_area,status").eq("hospital_id", selected.hospital_id).eq("status", "active").order("reference_code", { ascending: true }).limit(500)
      ]);
      if (itemsError) throw itemsError;
      if (refsError) throw new Error("Unable to load patient references. Confirm the patient-reference migration has been applied.");
      setItems((data ?? []) as Row[]);
      setPatientReferences((refs ?? []) as PatientReference[]);
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to load operational records."); }
    finally { setLoading(false); }
  }, [router, supabase, type]);

  useEffect(() => { void load(); }, [load]);

  const visible = useMemo(() => items.filter(item => {
    const matchesStatus = status === "all" || item.status === status || (status === "open" && !["resolved","closed"].includes(item.status));
    const q = search.trim().toLowerCase();
    const linkedReference = patientReferences.find(reference => reference.id === item.patient_record_id)?.reference_code ?? "";
    return matchesStatus && (!q || [item.reference_code,item.title,item.external_reference ?? "",item.status,linkedReference].some(v => v.toLowerCase().includes(q)));
  }), [items, search, status]);

  const canCreate = ["owner", "admin", "clinician", "operations"].includes(role);
  const icon = type === "appointment" ? <CalendarDays size={20}/> : type === "exception" ? <ShieldCheck size={20}/> : <Users size={20}/>;

  async function createItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || !hospitalId || !userId) return;
    const reference = newReference.trim();
    const title = newTitle.trim();
    if (reference.length < 2 || reference.length > 80 || title.length < 3 || title.length > 240) {
      setError("Enter a reference of 2–80 characters and a title of 3–240 characters."); return;
    }
    setSaving(true); setError(""); setNotice("");
    try {
      const { data, error: insertError } = await supabase.from("work_items").insert({
        hospital_id: hospitalId, reference_code: reference, title, summary: newSummary.trim() || null,
        item_type: type, priority: newPriority, status: newStatus, external_reference: newExternalReference.trim() || null,
        patient_record_id: newPatientRecordId || null, due_at: newDueAt ? new Date(newDueAt).toISOString() : null, created_by: userId
      }).select("id,reference_code,title,summary,item_type,priority,status,owner_id,external_reference,due_at,patient_record_id,created_at,updated_at").single();
      if (insertError) throw insertError;
      const { error: auditError } = await supabase.from("audit_events").insert({
        hospital_id: hospitalId, actor_id: userId, entity_type: "work_item", entity_id: data.id,
        action: "work_item_created", details: { reference_code: reference, item_type: type, priority: newPriority, status: newStatus }
      });
      setItems(current => [data as Row, ...current]);
      setShowCreate(false); setNewReference(""); setNewTitle(""); setNewSummary(""); setNewExternalReference(""); setNewPatientRecordId(""); setNewPriority("medium"); setNewStatus("open"); setNewDueAt("");
      setNotice(auditError ? "Record created. The audit event could not be recorded, so please notify your administrator." : "Operational record created.");
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to create this record. Check that the reference is unique within your hospital."); }
    finally { setSaving(false); }
  }

  async function updateStatus(item: Row, nextStatus: WorkStatus) {
    if (!supabase || !hospitalId || !userId || nextStatus === item.status) return;
    setChangingId(item.id); setError(""); setNotice("");
    try {
      const { data, error: updateError } = await supabase.from("work_items").update({ status: nextStatus }).eq("id", item.id).eq("hospital_id", hospitalId).select("id,status,updated_at").single();
      if (updateError) throw updateError;
      const { error: auditError } = await supabase.from("audit_events").insert({
        hospital_id: hospitalId, actor_id: userId, entity_type: "work_item", entity_id: item.id,
        action: "work_item_status_changed", details: { reference_code: item.reference_code, previous_status: item.status, status: nextStatus }
      });
      setItems(current => current.map(row => row.id === item.id ? { ...row, status: data.status as WorkStatus, updated_at: data.updated_at } : row));
      setNotice(auditError ? "Status updated, but the audit event could not be recorded. Please notify your administrator." : "Record status updated.");
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to update this record."); }
    finally { setChangingId(""); }
  }

  return <main style={{minHeight:"100vh",background:"#f6f8fa",color:"#172b3a",fontFamily:"Arial,Helvetica,sans-serif"}}>
    <header style={{minHeight:68,background:"#fff",borderBottom:"1px solid #e5ebef",display:"flex",alignItems:"center",justifyContent:"space-between",padding:"12px clamp(16px,4vw,44px)",gap:12}}>
      <Link href="/" style={{display:"inline-flex",alignItems:"center",gap:8,color:"#187e79",fontSize:12,fontWeight:700,textDecoration:"none"}}><ArrowLeft size={16}/> Overview</Link>
      <span style={{fontSize:12,color:"#72818d",textAlign:"right"}}>{hospitalName || "Hospital workspace"}</span>
    </header>
    <div style={{maxWidth:1200,margin:"0 auto",padding:"32px clamp(16px,4vw,40px)"}}>
      <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:8,color:"#137c79"}}>{icon}<span style={{fontSize:10,fontWeight:700,letterSpacing:1.2}}>WORKSPACE / OPERATIONAL QUEUE</span></div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:16,flexWrap:"wrap"}}>
        <div><h1 style={{fontSize:"clamp(26px,4vw,34px)",letterSpacing:-1,margin:"12px 0 8px"}}>{titles[type] ?? "Operational work"}</h1><p style={{color:"#72818d",fontSize:13,margin:"0 0 24px"}}>{descriptions[type] ?? "Review and coordinate operational work."}</p></div>
        {canCreate && <button onClick={()=>{setError("");setNotice("");setShowCreate(true);}} style={{display:"inline-flex",alignItems:"center",gap:8,border:0,borderRadius:8,padding:"11px 14px",background:"#167c78",color:"#fff",fontSize:12,fontWeight:700,cursor:"pointer"}}><Plus size={16}/> New record</button>}
      </div>
      {error && <div role="alert" style={{padding:14,background:"#fff3f1",border:"1px solid #f0d8d4",borderRadius:8,color:"#9a4e47",fontSize:12,marginBottom:16}}>{error}</div>}
      {notice && <div role="status" style={{padding:12,background:"#edf8f4",border:"1px solid #cce7dc",borderRadius:8,color:"#276c5b",fontSize:12,marginBottom:16}}>{notice}</div>}
      <div style={{display:"flex",gap:10,flexWrap:"wrap",marginBottom:18}}>
        <label style={{display:"flex",alignItems:"center",gap:8,background:"#fff",border:"1px solid #e5ebef",borderRadius:8,padding:"10px 12px",flex:"1 1 230px",color:"#72818d"}}><Search size={16}/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search reference or title" style={{border:0,outline:0,width:"100%",fontSize:12}}/></label>
        <select aria-label="Filter by status" value={status} onChange={e=>setStatus(e.target.value)} style={{border:"1px solid #e5ebef",borderRadius:8,padding:"10px 12px",background:"#fff",color:"#344b57",fontSize:12}}><option value="open">Open items</option><option value="needs_review">Needs review</option><option value="in_progress">In progress</option><option value="awaiting_response">Awaiting response</option><option value="resolved">Resolved</option><option value="closed">Closed</option><option value="all">All statuses</option></select>
        <button onClick={()=>void load()} disabled={loading} style={{display:"inline-flex",alignItems:"center",gap:7,border:"1px solid #dce5e9",borderRadius:8,padding:"10px 13px",background:"#fff",color:"#187e79",fontSize:12,cursor:"pointer"}}><RefreshCw size={14}/> Refresh</button>
      </div>
      <section style={{background:"#fff",border:"1px solid #e5ebef",borderRadius:12,overflow:"hidden"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"16px 18px",borderBottom:"1px solid #e5ebef"}}><strong style={{fontSize:13}}>Records</strong><span style={{fontSize:11,color:"#72818d"}}>{visible.length} shown</span></div>
        {loading ? <p style={{padding:24,color:"#72818d",fontSize:12}}>Loading authorised records…</p> : visible.length === 0 ? <div style={{padding:36,textAlign:"center"}}><CheckCircle2 size={24} color="#7a9e98"/><p style={{fontSize:13,fontWeight:700}}>No matching records</p><p style={{fontSize:12,color:"#72818d"}}>Create a record for this queue or try another status filter. Records remain scoped to your authorised hospital.</p></div> :
          <div style={{overflowX:"auto"}}><table style={{width:"100%",borderCollapse:"collapse",minWidth:800,textAlign:"left"}}><thead><tr>{["REFERENCE / TITLE","STATUS","PRIORITY","DUE DATE","UPDATED","UPDATE STATUS"].map(label=><th key={label} style={{padding:"12px 16px",fontSize:9,letterSpacing:".7px",color:"#829099",background:"#fafcfc",borderBottom:"1px solid #e5ebef"}}>{label}</th>)}</tr></thead><tbody>{visible.map(item=><tr key={item.id}>
            <td style={{padding:"15px 16px",borderBottom:"1px solid #edf1f3"}}><strong style={{display:"block",fontSize:12,marginBottom:5}}>{item.reference_code}</strong><span style={{fontSize:12,color:"#526570"}}>{item.title}</span>{patientReferences.find(reference => reference.id === item.patient_record_id) && <p style={{fontSize:10,color:"#167c78",margin:"6px 0 0"}}>Patient ref: {patientReferences.find(reference => reference.id === item.patient_record_id)?.reference_code}</p>}{item.summary && <p style={{fontSize:10,color:"#829099",margin:"6px 0 0",maxWidth:400}}>{item.summary}</p>}</td>
            <td style={{padding:"15px 16px",borderBottom:"1px solid #edf1f3",fontSize:11}}>{statusLabels[item.status] ?? item.status}</td>
            <td style={{padding:"15px 16px",borderBottom:"1px solid #edf1f3",fontSize:11,textTransform:"capitalize"}}>{item.priority}</td>
            <td style={{padding:"15px 16px",borderBottom:"1px solid #edf1f3",fontSize:11,color:"#72818d"}}>{item.due_at ? new Date(item.due_at).toLocaleDateString("en-GB") : "—"}</td>
            <td style={{padding:"15px 16px",borderBottom:"1px solid #edf1f3",fontSize:11,color:"#72818d"}}>{new Date(item.updated_at).toLocaleDateString("en-GB")}</td>
            <td style={{padding:"12px 14px",borderBottom:"1px solid #edf1f3"}}><select aria-label={"Update status for "+item.reference_code} value={item.status} disabled={changingId===item.id} onChange={e=>void updateStatus(item,e.target.value as WorkStatus)} style={{maxWidth:155,border:"1px solid #dce5e9",borderRadius:7,padding:8,background:"#fff",fontSize:11,color:"#344b57"}}>{validStatuses.map(value=><option key={value} value={value}>{statusLabels[value]}</option>)}</select></td>
          </tr>)}</tbody></table></div>}
      </section>
      <p style={{fontSize:10,color:"#829099",lineHeight:1.6,marginTop:16}}>Operational references only. Avoid patient names, dates of birth, diagnoses, or other direct identifiers in titles and summaries. Changes are subject to Supabase row-level security.</p>
    </div>
    {showCreate && <div role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget)setShowCreate(false);}} style={{position:"fixed",inset:0,zIndex:50,background:"rgba(17,35,44,.42)",display:"grid",placeItems:"center",padding:16}}>
      <section role="dialog" aria-modal="true" aria-labelledby="create-title" style={{width:"min(640px,100%)",maxHeight:"92vh",overflowY:"auto",background:"#fff",borderRadius:14,padding:"24px clamp(18px,4vw,30px)",boxShadow:"0 24px 80px rgba(0,0,0,.18)"}}>
        <div style={{display:"flex",justifyContent:"space-between",gap:12,alignItems:"flex-start"}}><div><p style={{fontSize:10,letterSpacing:1.2,color:"#167c78",fontWeight:700,margin:"0 0 8px"}}>NEW {labels[type].toUpperCase()}</p><h2 id="create-title" style={{fontSize:23,margin:"0 0 8px",letterSpacing:-.5}}>Create operational record</h2><p style={{fontSize:12,color:"#72818d",margin:"0 0 22px"}}>Use an internal reference. Do not include unnecessary patient-identifying information.</p></div><button aria-label="Close form" onClick={()=>setShowCreate(false)} style={{border:0,background:"transparent",cursor:"pointer",color:"#72818d"}}><X size={20}/></button></div>
        <form onSubmit={createItem} style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(220px,1fr))",gap:14}}>
          <label style={{display:"grid",gap:6,fontSize:12,color:"#526570"}}>Internal reference *<input required maxLength={80} value={newReference} onChange={e=>setNewReference(e.target.value)} placeholder="e.g. ACC-2026-001" style={{padding:11,border:"1px solid #dce5e9",borderRadius:8,fontSize:13}}/></label>
          <label style={{display:"grid",gap:6,fontSize:12,color:"#526570"}}>Title *<input required minLength={3} maxLength={240} value={newTitle} onChange={e=>setNewTitle(e.target.value)} placeholder="Brief operational description" style={{padding:11,border:"1px solid #dce5e9",borderRadius:8,fontSize:13}}/></label>
          <label style={{display:"grid",gap:6,fontSize:12,color:"#526570",gridColumn:"1 / -1"}}>Linked patient reference (optional)<select value={newPatientRecordId} onChange={e=>setNewPatientRecordId(e.target.value)} style={{padding:11,border:"1px solid #dce5e9",borderRadius:8,fontSize:13,background:"#fff"}}><option value="">No patient reference linked</option>{patientReferences.map(reference=><option key={reference.id} value={reference.id}>{reference.reference_code}{reference.care_area ? " · "+reference.care_area : ""}</option>)}</select><span style={{fontSize:10,color:"#829099"}}>Only active references from this hospital are available.</span></label>
          <label style={{display:"grid",gap:6,fontSize:12,color:"#526570"}}>Priority<select value={newPriority} onChange={e=>setNewPriority(e.target.value as Priority)} style={{padding:11,border:"1px solid #dce5e9",borderRadius:8,fontSize:13,background:"#fff"}}>{validPriorities.map(value=><option key={value} value={value}>{value[0].toUpperCase()+value.slice(1)}</option>)}</select></label>
          <label style={{display:"grid",gap:6,fontSize:12,color:"#526570"}}>Initial status<select value={newStatus} onChange={e=>setNewStatus(e.target.value as WorkStatus)} style={{padding:11,border:"1px solid #dce5e9",borderRadius:8,fontSize:13,background:"#fff"}}>{validStatuses.map(value=><option key={value} value={value}>{statusLabels[value]}</option>)}</select></label>
          <label style={{display:"grid",gap:6,fontSize:12,color:"#526570"}}>External reference (optional)<input maxLength={120} value={newExternalReference} onChange={e=>setNewExternalReference(e.target.value)} placeholder="Non-sensitive external ID" style={{padding:11,border:"1px solid #dce5e9",borderRadius:8,fontSize:13}}/></label>
          <label style={{display:"grid",gap:6,fontSize:12,color:"#526570"}}>Due date (optional)<input type="datetime-local" value={newDueAt} onChange={e=>setNewDueAt(e.target.value)} style={{padding:11,border:"1px solid #dce5e9",borderRadius:8,fontSize:13}}/></label>
          <label style={{display:"grid",gap:6,fontSize:12,color:"#526570",gridColumn:"1 / -1"}}>Summary (optional)<textarea maxLength={2000} rows={3} value={newSummary} onChange={e=>setNewSummary(e.target.value)} placeholder="Short operational context; avoid clinical details and direct identifiers." style={{padding:11,border:"1px solid #dce5e9",borderRadius:8,fontSize:13,resize:"vertical"}}/></label>
          <div style={{display:"flex",justifyContent:"flex-end",gap:10,gridColumn:"1 / -1",marginTop:6}}><button type="button" onClick={()=>setShowCreate(false)} style={{padding:"11px 15px",border:"1px solid #dce5e9",borderRadius:8,background:"#fff",color:"#526570",cursor:"pointer"}}>Cancel</button><button type="submit" disabled={saving} style={{display:"inline-flex",alignItems:"center",gap:8,padding:"11px 15px",border:0,borderRadius:8,background:"#167c78",color:"#fff",fontWeight:700,cursor:saving?"wait":"pointer"}}><Save size={15}/>{saving?"Saving…":"Create record"}</button></div>
        </form>
      </section>
    </div>}
  </main>;
}
