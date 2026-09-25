"use client";
import { useEffect, useState } from "react";
export default function SocialPage(){
 const [items,setItems]=useState<any[]|null>(null);
 useEffect(()=>{fetch('/api/me/feed').then(r=>r.ok?r.json():[]).then(setItems)},[]);
 return <main className="wrap"><section className="glass hero"><div><p className="muted">VORTEX COMMUNITY</p><h1>Activity Feed</h1><p>تابع نشاطك ونشاط اللاعبين الذين تتابعهم.</p></div><div className="orb">👥</div></section><section className="glass card">{items===null?<p>Loading…</p>:items.length===0?<p className="muted">لا يوجد نشاط بعد. ابدأ بإضافة ألعاب إلى مكتبتك.</p>:<div className="grid">{items.map(i=><article className="glass card" key={i.id}><strong>@{i.user.username||'gamer'}</strong><p>{i.message||i.type}</p>{i.game&&<p className="muted">🎮 {i.game.titleAr}</p>}<small className="muted">{new Date(i.createdAt).toLocaleString('ar')}</small></article>)}</div>}</section></main>;
}
