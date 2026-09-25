"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
export default function Recommendations(){
 const [data,setData]=useState<any>(null); const [error,setError]=useState("");
 useEffect(()=>{fetch('/api/me/recommendations').then(async r=>{if(!r.ok) throw new Error('Login required'); return r.json()}).then(setData).catch(e=>setError(e.message))},[]);
 if(error)return <main className="wrap"><section className="glass card"><h1>Vortex Recommendations</h1><p>{error}</p></section></main>;
 if(!data)return <main className="wrap"><section className="glass card">Loading recommendations…</section></main>;
 return <main className="wrap"><section className="glass hero"><div><p className="muted">VORTEX ENGINE</p><h1>ألعاب مقترحة لك</h1><p>توصيات محلية تعتمد على مكتبتك واهتماماتك وVortex Score، بدون الحاجة إلى مزود AI خارجي.</p></div><div className="orb">🤖</div></section><section className="grid">{data.recommendations.map((r:any)=><Link href={`/games/${r.game.slug}`} className="glass card" key={r.game.id}>{r.game.coverUrl&&<img className="cover" src={r.game.coverUrl} alt={r.game.titleEn}/>}<span className="badge">MATCH {r.recommendationScore}</span><h2>{r.game.titleAr}</h2><p className="muted">{r.game.titleEn} · Vortex {r.game.ratingAverage.toFixed(1)}</p><p className="muted">{r.reasons.join(' · ')}</p></Link>)}</section></main>;
}
