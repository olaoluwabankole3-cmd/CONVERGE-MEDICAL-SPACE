"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, CalendarDays, CheckCircle2, Clock3, RefreshCw, Search, ShieldCheck, Users } from "lucide-react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

type WorkType = "access_case" | "appointment" | "follow_up" | "exception" | "task";
type Row = { id: string; reference_code: string; title: string; summary: string | null; item_type: WorkType; priority: string; status: string; owner_id: string | null; external_reference: string | null; due_at: string | null; created_at: string; updated_at: string };
const labels: Record<WorkType,string> = { access_case: "Access case", appointment: "Appointment", follow_up: "Follow-up", exception: "Exception", task: "Task" };
const statusLabels: Record<string,string> = { draft: "Draft", open: "Open", needs_review: "Needs review", in_progress: "In progress", awaiting_response: "Awaiting response", resolved: "Resolved", closed: "Closed" };
const titles: Record<string,string> = { access_case: "Access cases", appointment: "Appointments", follow_up: "Follow-ups & tasks", exception: "Exceptions", task: "Follow-ups & tasks" };
const descriptions: Record<string,string> = { access_case: "Coordinate and track operational access requests.", appointment: "Review appointment-related operational work.", follow_up: "Track outstanding follow-ups and operational tasks.", exception: "Review exceptions that need operational attention.", task: "Track outstanding operational tasks." };

export default function WorkPage() {
  const router = useRouter();
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);
  const [type, setType] = useState("access_case");
  const [items, setItems] = useState<Row[]>([]);
  const [hospitalName, setHospitalName] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("open");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const value = params.get("type") ?? "access_case";
    if (["access_case", "appointment", "follow_up", "exception", "task"].includes(value)) setType(value);
    const requestedStatus = params.get("status");
    if (requestedStatus && ["all","open","needs_review","in_progress","awaiting_response","resolved","closed"].includes(requestedStatus)) setStatus(requestedStatus);
  }, []);

  const load = useCallback(async () => {
    if (!supabase) { setError("Supabase is not configured for this deployment."); setLoading(false); return; }
    setLoading(true); setError("");
    try {
      const { data: auth, error: authError } = await supabase.auth.getUser();
      if (authError || !auth.user) { router.replace("/login"); return; }
      const { data: memberships, error: memberError } = await supabase.from("hospital_memberships").select("hospital_id").order("created_at", { ascending: false }).limit(1);
      if (memberError) throw memberError;
      const hospitalId = memberships?.[0]?.hospital_id;
      if (!hospitalId) { setItems([]); setError("Your hospital workspace is not active or your membership is not available."); return; }
      const { data: hospital, error: hospitalError } = await supabase.from("hospitals").select("name,status").eq("id", hospitalId).maybeSingle();
      if (hospitalError) throw hospitalError;
      setHospitalName(hospital?.name ?? "Hospital workspace");
      if (hospital?.status !== "active") { setItems([]); setError("This hospital workspace must be approved before operational records are available."); return; }
      const { data, error: itemsError } = await supabase.from("work_items").select("id,reference_code,title,summary,item_type,priority,status,owner_id,external_reference,due_at,created_at,updated_at").eq("hospital_id", hospitalId).eq("item_type", type).order("updated_at", { ascending: false }).limit(200);
      if (itemsError) throw itemsError;
      setItems((data ?? []) as Row[]);
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to load operational records."); }
    finally { setLoading(false); }
  }, [router, supabase, type]);

  useEffect(() => { void load(); }, [load]);
  const visible = useMemo(() => items.filter(item => {
    const matchesStatus = status === "all" || item.status === status || (status === "open" && !["resolved","closed"].includes(item.status));
    const q = search.trim().toLowerCase();
    return matchesStatus && (!q || [item.reference_code,item.title,item.external_reference ?? "",item.status].some(v => v.toLowerCase().includes(q)));
  }), [items, search, status]);

  const icon = type === "appointment" ? <CalendarDays size={20}/> : type === "exception" ? <ShieldCheck size={20}/> : <Users size={20}/>;
  return <main style={{minHeight:"100vh",background:"#f6f8fa",color:"#172b3a",fontFamily:"Arial,Helvetica,sans-serif"}}>
    <header style={{height:68,background:"#fff",borderBottom:"1px solid #e5ebef",display:"flex",alignItems:"center",justifyContent:"space-between",padding:"0 clamp(16px,4vw,44px)",gap:12}}>
      <Link href="/" style={{display:"inline-flex",alignItems:"center",gap:8,color:"#187e79",fontSize:12,fontWeight:700,textDecoration:"none"}}><ArrowLeft size={16}/> Overview</Link>
      <span style={{fontSize:12,color:"#72818d"}}>{hospitalName || "Hospital workspace"}</span>
    </header>
    <div style={{maxWidth:1200,margin:"0 auto",padding:"32px clamp(16px,4vw,40px)"}}>
      <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:8,color:"#137c79"}}>{icon}<span style={{fontSize:10,fontWeight:700,letterSpacing:1.2}}>WORKSPACE / OPERATIONAL QUEUE</span></div>
      <h1 style={{fontSize:"clamp(26px,4vw,34px)",letterSpacing:-1,margin:"12px 0 8px"}}>{titles[type] ?? "Operational work"}</h1>
      <p style={{color:"#72818d",fontSize:13,margin:"0 0 24px"}}>{descriptions[type] ?? "Review and coordinate operational work."}</p>
      <div style={{display:"flex",gap:10,flexWrap:"wrap",marginBottom:18}}>
        <label style={{display:"flex",alignItems:"center",gap:8,background:"#fff",border:"1px solid #e5ebef",borderRadius:8,padding:"10px 12px",flex:"1 1 230px",color:"#72818d"}}><Search size={16}/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search reference or title" style={{border:0,outline:0,width:"100%",fontSize:12}}/></label>
        <select aria-label="Filter by status" value={status} onChange={e=>setStatus(e.target.value)} style={{border:"1px solid #e5ebef",borderRadius:8,padding:"10px 12px",background:"#fff",color:"#344b57",fontSize:12}}><option value="open">Open items</option><option value="needs_review">Needs review</option><option value="in_progress">In progress</option><option value="awaiting_response">Awaiting response</option><option value="resolved">Resolved</option><option value="closed">Closed</option><option value="all">All statuses</option></select>
        <button onClick={()=>void load()} disabled={loading} style={{display:"inline-flex",alignItems:"center",gap:7,border:"1px solid #dce5e9",borderRadius:8,padding:"10px 13px",background:"#fff",color:"#187e79",fontSize:12,cursor:"pointer"}}><RefreshCw size={14}/> Refresh</button>
      </div>
      {error && <div role="alert" style={{padding:14,background:"#fff3f1",border:"1px solid #f0d8d4",borderRadius:8,color:"#9a4e47",fontSize:12,marginBottom:16}}>{error}</div>}
      <section style={{background:"#fff",border:"1px solid #e5ebef",borderRadius:12,overflow:"hidden"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"16px 18px",borderBottom:"1px solid #e5ebef"}}><strong style={{fontSize:13}}>Records</strong><span style={{fontSize:11,color:"#72818d"}}>{visible.length} shown</span></div>
        {loading ? <p style={{padding:24,color:"#72818d",fontSize:12}}>Loading authorised records…</p> : visible.length === 0 ? <div style={{padding:36,textAlign:"center"}}><CheckCircle2 size={24} color="#7a9e98"/><p style={{fontSize:13,fontWeight:700}}>No matching records</p><p style={{fontSize:12,color:"#72818d"}}>Try another status filter or search term. Records remain scoped to your authorised hospital.</p></div> :
          <div style={{overflowX:"auto"}}><table style={{width:"100%",borderCollapse:"collapse",minWidth:680,textAlign:"left"}}><thead><tr>{["REFERENCE / TITLE","STATUS","PRIORITY","DUE DATE","UPDATED"].map(label=><th key={label} style={{padding:"12px 16px",fontSize:9,letterSpacing:".7px",color:"#829099",background:"#fafcfc",borderBottom:"1px solid #e5ebef"}}>{label}</th>)}</tr></thead><tbody>{visible.map(item=><tr key={item.id}><td style={{padding:"15px 16px",borderBottom:"1px solid #edf1f3"}}><strong style={{display:"block",fontSize:12,marginBottom:5}}>{item.reference_code}</strong><span style={{fontSize:12,color:"#526570"}}>{item.title}</span>{item.summary && <p style={{fontSize:10,color:"#829099",margin:"6px 0 0",maxWidth:400}}>{item.summary}</p>}</td><td style={{padding:"15px 16px",borderBottom:"1px solid #edf1f3",fontSize:11}}>{statusLabels[item.status] ?? item.status}</td><td style={{padding:"15px 16px",borderBottom:"1px solid #edf1f3",fontSize:11,textTransform:"capitalize"}}>{item.priority}</td><td style={{padding:"15px 16px",borderBottom:"1px solid #edf1f3",fontSize:11,color:"#72818d"}}>{item.due_at ? new Date(item.due_at).toLocaleDateString("en-GB") : "—"}</td><td style={{padding:"15px 16px",borderBottom:"1px solid #edf1f3",fontSize:11,color:"#72818d"}}>{new Date(item.updated_at).toLocaleDateString("en-GB")}</td></tr>)}</tbody></table></div>}
      </section>
      <p style={{fontSize:10,color:"#829099",lineHeight:1.6,marginTop:16}}>Operational references only. Do not add unnecessary patient-identifying information to titles or summaries.</p>
    </div>
  </main>;
}
