"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, FileClock, RefreshCw, ShieldCheck } from "lucide-react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

type EventRow = { id: number; entity_type: string; entity_id: string; action: string; details: Record<string, unknown> | null; created_at: string };

export default function AuditHistoryPage() {
  const router = useRouter();
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [hospitalName, setHospitalName] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    if (!supabase) { setError("Supabase is not configured for this deployment."); setLoading(false); return; }
    setLoading(true); setError("");
    try {
      const { data: auth, error: authError } = await supabase.auth.getUser();
      if (authError || !auth.user) { router.replace("/login"); return; }
      const { data: memberships, error: memberError } = await supabase.from("hospital_memberships").select("hospital_id").order("created_at", { ascending: false }).limit(1);
      if (memberError) throw memberError;
      const hospitalId = memberships?.[0]?.hospital_id;
      if (!hospitalId) { setEvents([]); setError("Your hospital workspace membership is not available."); return; }
      const { data: hospital, error: hospitalError } = await supabase.from("hospitals").select("name,status").eq("id", hospitalId).maybeSingle();
      if (hospitalError) throw hospitalError;
      setHospitalName(hospital?.name ?? "Hospital workspace");
      if (hospital?.status !== "active") { setEvents([]); setError("Audit history is available after hospital approval."); return; }
      const { data, error: eventError } = await supabase.from("audit_events").select("id,entity_type,entity_id,action,details,created_at").eq("hospital_id", hospitalId).order("created_at", { ascending: false }).limit(200);
      if (eventError) throw eventError;
      setEvents((data ?? []) as EventRow[]);
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to load audit history."); }
    finally { setLoading(false); }
  }, [router, supabase]);
  useEffect(() => { void load(); }, [load]);
  return <main style={{minHeight:"100vh",background:"#f6f8fa",color:"#172b3a",fontFamily:"Arial,Helvetica,sans-serif"}}><header style={{height:68,background:"#fff",borderBottom:"1px solid #e5ebef",display:"flex",alignItems:"center",justifyContent:"space-between",padding:"0 clamp(16px,4vw,44px)"}}><Link href="/" style={{display:"inline-flex",alignItems:"center",gap:8,color:"#187e79",fontSize:12,fontWeight:700,textDecoration:"none"}}><ArrowLeft size={16}/> Overview</Link><span style={{fontSize:12,color:"#72818d"}}>{hospitalName}</span></header><div style={{maxWidth:1100,margin:"0 auto",padding:"32px clamp(16px,4vw,40px)"}}><div style={{display:"flex",alignItems:"center",gap:10,color:"#137c79"}}><FileClock size={20}/><span style={{fontSize:10,fontWeight:700,letterSpacing:1.2}}>GOVERNANCE / AUDIT HISTORY</span></div><h1 style={{fontSize:"clamp(26px,4vw,34px)",letterSpacing:-1,margin:"14px 0 8px"}}>Audit history</h1><p style={{fontSize:13,color:"#72818d",margin:"0 0 24px"}}>A chronological record of changes and operational events in your authorised hospital workspace.</p>{error && <div role="alert" style={{padding:14,background:"#fff3f1",border:"1px solid #f0d8d4",borderRadius:8,color:"#9a4e47",fontSize:12,marginBottom:16}}>{error}</div>}<section style={{background:"#fff",border:"1px solid #e5ebef",borderRadius:12,overflow:"hidden"}}><div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"16px 18px",borderBottom:"1px solid #e5ebef"}}><strong style={{fontSize:13}}>Recorded events</strong><button onClick={()=>void load()} disabled={loading} style={{display:"inline-flex",alignItems:"center",gap:7,border:"1px solid #dce5e9",borderRadius:8,padding:"9px 12px",background:"#fff",color:"#187e79",fontSize:11,cursor:"pointer"}}><RefreshCw size={13}/> Refresh</button></div>{loading ? <p style={{padding:24,color:"#72818d",fontSize:12}}>Loading audit history…</p> : events.length===0 ? <div style={{padding:32,textAlign:"center",color:"#72818d",fontSize:12}}><ShieldCheck size={22}/><p>No audit events recorded yet.</p></div> : events.map(event=><article key={event.id} style={{display:"flex",gap:13,padding:"16px 18px",borderBottom:"1px solid #edf1f3"}}><div style={{width:34,height:34,display:"grid",placeItems:"center",background:"#eff5f5",color:"#538784",borderRadius:8,flexShrink:0}}><FileClock size={16}/></div><div style={{minWidth:0,flex:1}}><strong style={{fontSize:12,textTransform:"capitalize"}}>{event.action.replaceAll("_"," ")}</strong><p style={{fontSize:11,color:"#72818d",margin:"5px 0"}}>{event.entity_type.replaceAll("_"," ")} · Reference {typeof event.details?.reference_code==="string" ? event.details.reference_code : event.entity_id.slice(0,8)}</p><time style={{fontSize:10,color:"#9ba6ac"}}>{new Date(event.created_at).toLocaleString("en-GB")}</time></div></article>)}</section><p style={{fontSize:10,color:"#829099",lineHeight:1.6,marginTop:16}}>Audit visibility is limited by the signed-in user’s hospital membership and database policies.</p></div></main>;
}
