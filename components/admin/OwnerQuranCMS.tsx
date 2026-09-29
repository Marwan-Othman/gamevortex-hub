'use client';

import { FormEvent, useEffect, useState } from 'react';

type Reciter = {
  id: string; nameAr: string; nameEn: string; riwayah?: string | null; style?: string | null;
  quality?: string | null; provider: string; legalSourceUrl: string; licenseUrl?: string | null;
  licenseStatus: string; sourceVerificationStatus: string; audioBaseUrl: string;
  active: boolean; sortOrder: number; notes?: string | null;
};

const empty = { nameAr:'', nameEn:'', riwayah:'', style:'Murattal', quality:'128kbps', provider:'', legalSourceUrl:'', licenseUrl:'', licenseStatus:'PENDING_VERIFICATION', audioBaseUrl:'', active:false, sortOrder:0, notes:'' };

export default function OwnerQuranCMS() {
  const [items, setItems] = useState<Reciter[]>([]);
  const [form, setForm] = useState<any>(empty);
  const [editing, setEditing] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [verification, setVerification] = useState('PENDING_REVIEW');
  const load = async () => { const r = await fetch('/api/owner/quran/reciters'); if (r.ok) setItems(await r.json()); };
  useEffect(() => { load(); }, []);
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setMessage('جاري الحفظ...');
    const payload = { ...form, sourceVerificationStatus: verification, sortOrder: Number(form.sortOrder), availableSurahs: Array.from({length:114}, (_,i)=>i+1) };
    const r = await fetch('/api/owner/quran/reciters', { method: editing ? 'PATCH' : 'POST', headers:{'content-type':'application/json'}, body: JSON.stringify(editing ? {...payload,id:editing} : payload) });
    const data = await r.json();
    if (!r.ok) { setMessage(data.error ?? 'حدث خطأ'); return; }
    setMessage(verification === 'VERIFIED' ? 'تم الحفظ والتحقق. تأكد من الترخيص قبل التفعيل.' : 'تم الحفظ بدون نشر المصدر حتى يكتمل التحقق.'); setForm(empty); setEditing(null); load();
  };
  const remove = async (id:string) => { if (!confirm('حذف هذا القارئ؟')) return; await fetch(`/api/owner/quran/reciters?id=${id}`, {method:'DELETE'}); load(); };
  const edit = (r:Reciter) => { setEditing(r.id); setVerification(r.sourceVerificationStatus); setForm({...r}); window.scrollTo({top:0,behavior:'smooth'}); };
  return <main className="wrap" dir="rtl">
    <section className="glass hero"><h1>إدارة قراء القرآن</h1><p>إضافة عدد غير محدود من القراء، ولكل قارئ مصدر قانوني/رسمي مستقل.</p></section>
    <section className="glass card" style={{marginBottom:24}}><h2>{editing ? 'تعديل قارئ' : 'إضافة قارئ جديد'}</h2>
      <form onSubmit={submit} className="grid">
        {([['nameAr','اسم القارئ بالعربية'],['nameEn','اسم القارئ بالإنجليزية'],['riwayah','الرواية'],['style','الأسلوب'],['quality','الجودة'],['provider','المزود'],['legalSourceUrl','رابط المصدر الرسمي/القانوني HTTPS'],['licenseUrl','رابط الترخيص/الإذن HTTPS'],['licenseStatus','حالة الترخيص'],['audioBaseUrl','رابط الصوت الأساسي HTTPS'],['sortOrder','الترتيب'],['notes','ملاحظات']] as const).map(([key,label]) => <label key={key}>{label}<input className="input" value={form[key] ?? ''} onChange={e=>setForm({...form,[key]:e.target.value})} required={['nameAr','nameEn','provider','legalSourceUrl','licenseStatus','audioBaseUrl'].includes(key)} /></label>)}
        <label>حالة التحقق<select className="input" value={verification} onChange={e=>setVerification(e.target.value)}><option value="PENDING_REVIEW">قيد المراجعة</option><option value="VERIFIED">تم التحقق</option><option value="NEEDS_SOURCE">يحتاج مصدر</option><option value="UNPUBLISHED">غير منشور</option></select></label><label>مفعل الآن <input type="checkbox" checked={!!form.active} onChange={e=>setForm({...form,active:e.target.checked})}/></label>
        <div><button className="btn" type="submit">{editing?'حفظ التعديلات':'إضافة القارئ'}</button> <button className="btn" type="button" onClick={()=>{setForm(empty);setEditing(null)}}>إلغاء</button></div>
      </form><p className="muted">{message}</p>
    </section>
    <section><h2>القراء ({items.length})</h2><div className="grid">{items.map(r=><article className="glass card" key={r.id}><h3>{r.nameAr}</h3><p>{r.nameEn}</p><p>{r.provider} · {r.quality ?? '—'}</p><p>الحالة: {r.sourceVerificationStatus} · {r.active?'مفعل':'غير مفعل'}</p><p><a href={r.legalSourceUrl} target="_blank" rel="noreferrer">المصدر الرسمي/القانوني</a></p><div><button className="btn" onClick={()=>edit(r)}>تعديل</button> <button className="btn" onClick={()=>remove(r.id)}>حذف</button></div></article>)}</div></section>
  </main>;
}
