"use client";
import { useState } from "react";
export default function UserRoleSelect({ userId, initialRole, disabled }: { userId:string; initialRole:string; disabled?:boolean }) {
  const [role,setRole]=useState(initialRole); const [busy,setBusy]=useState(false); const [error,setError]=useState("");
  async function change(value:string){ const previous=role; setRole(value); setBusy(true); setError(""); try { const r=await fetch("/api/admin/owner-control",{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({userId,role:value})}); const data=await r.json(); if(!r.ok) throw new Error(data.error||"FAILED"); } catch(e){ setRole(previous); setError(e instanceof Error?e.message:"FAILED"); } finally { setBusy(false); } }
  return <span style={{display:"inline-flex",flexDirection:"column",gap:4}}><select value={role} disabled={disabled||busy} onChange={e=>change(e.target.value)}><option value="USER">USER</option><option value="STAFF">STAFF</option><option value="SUPER_ADMIN">SUPER_ADMIN</option></select>{error&&<small style={{color:"#ff6b81"}}>{error}</small>}</span>;
}
