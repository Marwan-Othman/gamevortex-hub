"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
type Game={id:string;slug:string;titleAr:string;titleEn:string;coverUrl?:string|null;ratingAverage:number;platform?:string|null};
type Item={id:string;status?:string;game:Game};
type Notice={id:string;title?:string|null;message?:string|null;readAt?:string|null;createdAt:string};
const tabs=[['all','الكل'],['PLAYING','ألعبها'],['WANT','أريد لعبها'],['BEATEN','أنهيتها'],['ARCHIVED','مؤرشفة']] as const;
export default function LibraryHub(){
 const [items,setItems]=useState<Item[]>([]),[favorites,setFavorites]=useState<Item[]>([]),[wishlist,setWishlist]=useState<Item[]>([]),[notes,setNotes]=useState<Notice[]>([]),[tab,setTab]=useState<(typeof tabs)[number][0]>('all'),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 async function load(){
  const [lr,fr,wr,nr]=await Promise.all([fetch(`/api/me/games/library${tab==='all'?'':`?status=${tab}`}`),fetch('/api/me/games/favorites'),fetch('/api/me/games/wishlist'),fetch('/api/me/notifications')]);
  if([lr,fr,wr,nr].some(r=>r.status===401)) throw new Error('يجب تسجيل الدخول أولًا'); if(!lr.ok) throw new Error('تعذر تحميل المكتبة');
  setItems(await lr.json()); setFavorites(fr.ok?await fr.json():[]); setWishlist(wr.ok?await wr.json():[]); setNotes(nr.ok?await nr.json():[]);
 }
 useEffect(()=>{setError('');load().catch(e=>setError(e.message));},[tab]);
 async function remove(gameId:string){setBusy(true);try{await fetch(`/api/me/games/library?gameId=${encodeURIComponent(gameId)}`,{method:'DELETE'});await load();}finally{setBusy(false)}}
 async function markRead(id?:string){await fetch('/api/me/notifications',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify(id?{id}:{})});await load()}
 const unread=useMemo(()=>notes.filter(n=>!n.readAt).length,[notes]);
 const favoriteIds=new Set(favorites.map(x=>x.game.id)),wishlistIds=new Set(wishlist.map(x=>x.game.id));
 if(error)return <main className="wrap"><section className="glass card"><h1>مكتبتي</h1><p>{error}</p><Link className="btn" href="/">العودة للرئيسية</Link></section></main>;
 return <main className="wrap">
  <section className="glass hero"><p className="muted">VORTEX LIBRARY</p><h1>مكتبتك في مكان واحد</h1><p>تتبّع الألعاب التي تلعبها، تريدها أو أنهيتها، مع المفضلة وقائمة الرغبات والإشعارات.</p><div className="tabs" role="tablist" aria-label="حالة المكتبة">{tabs.map(([value,label])=><button key={value} className={`btn ${tab===value?'':'secondary'}`} onClick={()=>setTab(value)} role="tab" aria-selected={tab===value}>{label}</button>)}</div></section>
  <section className="section-head"><h2>🎮 الألعاب ({items.length})</h2><Link href="/games" className="muted">اكتشف ألعابًا جديدة ←</Link></section>
  {items.length===0?<section className="glass card"><p className="muted">لا توجد ألعاب في هذا القسم بعد.</p></section>:<div className="grid">{items.map(item=><article className="glass card game-card" key={item.id}>{item.game.coverUrl&&<img className="cover" src={item.game.coverUrl} alt={item.game.titleEn} loading="lazy"/>}<div className="card-top"><span className="badge">{item.status||'LIBRARY'}</span><span>★ {item.game.ratingAverage.toFixed(1)}</span></div><h3>{item.game.titleAr}</h3><p className="muted">{item.game.titleEn} · {item.game.platform||'متعدد المنصات'}</p><div className="tabs"><Link href={`/games/${item.game.slug}`} className="btn">التفاصيل</Link><button className="btn secondary" disabled={busy} onClick={()=>remove(item.game.id)}>إزالة</button></div></article>)}</div>}
  <section className="feature-grid"><div className="section-head"><h2>❤️ المفضلة ({favorites.length})</h2><span className="muted">{favoriteIds.size} محفوظة</span></div><div className="grid">{favorites.slice(0,6).map(item=><Link className="glass card game-card" href={`/games/${item.game.slug}`} key={item.id}><h3>{item.game.titleAr}</h3><p className="muted">★ {item.game.ratingAverage.toFixed(1)} · {item.game.platform||'متعدد'}</p></Link>)}</div><div className="section-head"><h2>🔖 قائمة الرغبات ({wishlist.length})</h2><span className="muted">{wishlistIds.size} محفوظة</span></div><div className="grid">{wishlist.slice(0,6).map(item=><Link className="glass card game-card" href={`/games/${item.game.slug}`} key={item.id}><h3>{item.game.titleAr}</h3><p className="muted">{item.game.titleEn}</p></Link>)}</div></section>
  <section className="feature-grid"><div className="section-head"><h2>🔔 الإشعارات</h2><button className="btn secondary" onClick={()=>markRead()} disabled={!unread}>تحديد الكل كمقروء</button></div>{notes.length===0?<p className="muted">لا توجد إشعارات.</p>:<div className="grid">{notes.slice(0,8).map(n=><article className={`glass card ${n.readAt?'':'notification-unread'}`} key={n.id}><div className="card-top"><strong>{n.title||'GameVortex'}</strong>{!n.readAt&&<span className="badge">جديد</span>}</div><p>{n.message||'لديك تحديث جديد.'}</p><small className="muted">{new Date(n.createdAt).toLocaleString('ar')}</small>{!n.readAt&&<div><button className="btn secondary" onClick={()=>markRead(n.id)}>تمت القراءة</button></div>}</article>)}</div>}</section>
 </main>;
}
