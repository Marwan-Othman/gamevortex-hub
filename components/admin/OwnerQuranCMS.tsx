'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { NETWORK_ERROR_MESSAGE, readAdminError } from '@/lib/admin-client';

type Reciter = {
  id: string; nameAr: string; nameEn: string; riwayah?: string | null; style?: string | null;
  quality?: string | null; provider: string; legalSourceUrl: string; licenseUrl?: string | null;
  licenseStatus: string; sourceVerificationStatus: string; audioBaseUrl: string;
  active: boolean; sortOrder: number; notes?: string | null;
};

type FormState = {
  nameAr: string; nameEn: string; riwayah: string; style: string; quality: string; provider: string;
  legalSourceUrl: string; licenseUrl: string; licenseStatus: string; audioBaseUrl: string;
  active: boolean; sortOrder: number | string; notes: string;
};

const empty: FormState = { nameAr:'', nameEn:'', riwayah:'', style:'Murattal', quality:'128kbps', provider:'', legalSourceUrl:'', licenseUrl:'', licenseStatus:'PENDING_VERIFICATION', audioBaseUrl:'', active:false, sortOrder:0, notes:'' };

const FIELDS = [
  ['nameAr','اسم القارئ بالعربية'],['nameEn','اسم القارئ بالإنجليزية'],['riwayah','الرواية'],['style','الأسلوب'],
  ['quality','الجودة'],['provider','المزود'],['legalSourceUrl','رابط المصدر الرسمي/القانوني HTTPS'],
  ['licenseUrl','رابط الترخيص/الإذن HTTPS'],['licenseStatus','حالة الترخيص'],['audioBaseUrl','رابط الصوت الأساسي HTTPS'],
  ['sortOrder','الترتيب'],['notes','ملاحظات'],
] as const;

const REQUIRED = ['nameAr','nameEn','provider','legalSourceUrl','licenseStatus','audioBaseUrl'];

const STATUS_AR: Record<string, string> = {
  PENDING_REVIEW: 'قيد المراجعة', VERIFIED: 'تم التحقق', NEEDS_SOURCE: 'يحتاج مصدر', UNPUBLISHED: 'غير منشور',
};

export default function OwnerQuranCMS() {
  const [items, setItems] = useState<Reciter[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [form, setForm] = useState<FormState>(empty);
  const [editing, setEditing] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [messageIsError, setMessageIsError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [verification, setVerification] = useState('PENDING_REVIEW');

  const load = useCallback(async () => {
    setLoadError('');
    try {
      const r = await fetch('/api/owner/quran/reciters', { cache: 'no-store' });
      if (!r.ok) { setLoadError(await readAdminError(r, 'تعذر تحميل القراء.')); return; }
      const data = await r.json();
      setItems(Array.isArray(data) ? data : []);
    } catch {
      setLoadError(NETWORK_ERROR_MESSAGE);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const notify = (text: string, isError = false) => { setMessage(text); setMessageIsError(isError); };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    notify('جاري الحفظ...');
    try {
      const payload = { ...form, sourceVerificationStatus: verification, sortOrder: Number(form.sortOrder) || 0, availableSurahs: Array.from({ length: 114 }, (_, i) => i + 1) };
      const r = await fetch('/api/owner/quran/reciters', { method: editing ? 'PATCH' : 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(editing ? { ...payload, id: editing } : payload) });
      if (!r.ok) { notify(await readAdminError(r, 'تعذر حفظ القارئ. راجع الحقول المطلوبة وروابط HTTPS.'), true); return; }
      notify(verification === 'VERIFIED' ? 'تم الحفظ والتحقق. تأكد من الترخيص قبل التفعيل.' : 'تم الحفظ بدون نشر المصدر حتى يكتمل التحقق.');
      setForm(empty); setEditing(null); setVerification('PENDING_REVIEW');
      await load();
    } catch {
      notify(NETWORK_ERROR_MESSAGE, true);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    if (removingId || !confirm('حذف هذا القارئ؟')) return;
    setRemovingId(id);
    try {
      const r = await fetch(`/api/owner/quran/reciters?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (!r.ok) { notify(await readAdminError(r, 'تعذر حذف القارئ.'), true); return; }
      notify('تم حذف القارئ.');
      await load();
    } catch {
      notify(NETWORK_ERROR_MESSAGE, true);
    } finally {
      setRemovingId(null);
    }
  };

  const edit = (r: Reciter) => {
    setEditing(r.id);
    setVerification(r.sourceVerificationStatus);
    setForm({ ...empty, ...r, riwayah: r.riwayah ?? '', style: r.style ?? '', quality: r.quality ?? '', licenseUrl: r.licenseUrl ?? '', notes: r.notes ?? '' });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const cancel = () => { setForm(empty); setEditing(null); setVerification('PENDING_REVIEW'); notify(''); };

  return <main className="wrap" dir="rtl">
    <section className="glass hero"><h1>إدارة قراء القرآن</h1><p>إضافة عدد غير محدود من القراء، ولكل قارئ مصدر قانوني/رسمي مستقل.</p></section>
    <section className="glass card" style={{ marginBottom: 24 }}><h2>{editing ? 'تعديل قارئ' : 'إضافة قارئ جديد'}</h2>
      <form onSubmit={submit} className="grid">
        {FIELDS.map(([key, label]) => <label key={key}>{label}<input className="input" type={key === 'sortOrder' ? 'number' : 'text'} min={key === 'sortOrder' ? 0 : undefined} dir={key.endsWith('Url') ? 'ltr' : undefined} value={String(form[key] ?? '')} onChange={e => setForm({ ...form, [key]: e.target.value })} required={REQUIRED.includes(key)} disabled={saving} /></label>)}
        <label>حالة التحقق<select className="input" value={verification} onChange={e => setVerification(e.target.value)} disabled={saving}><option value="PENDING_REVIEW">قيد المراجعة</option><option value="VERIFIED">تم التحقق</option><option value="NEEDS_SOURCE">يحتاج مصدر</option><option value="UNPUBLISHED">غير منشور</option></select></label>
        <label>مفعل الآن <input type="checkbox" checked={!!form.active} onChange={e => setForm({ ...form, active: e.target.checked })} disabled={saving} /></label>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}><button className="btn" type="submit" disabled={saving}>{saving ? 'جاري الحفظ...' : editing ? 'حفظ التعديلات' : 'إضافة القارئ'}</button><button className="btn secondary" type="button" onClick={cancel} disabled={saving}>إلغاء</button></div>
      </form>
      {message ? <p role={messageIsError ? 'alert' : 'status'} style={{ marginTop: 10, color: messageIsError ? '#ff8fa3' : undefined }} className={messageIsError ? undefined : 'muted'}>{message}</p> : null}
    </section>
    <section><h2>القراء ({items.length})</h2>
      {loading ? <p className="muted" role="status">جارٍ تحميل القراء...</p> : null}
      {loadError ? <div className="glass card" role="alert"><p style={{ color: '#ff8fa3' }}>{loadError}</p><button className="btn" type="button" onClick={() => { setLoading(true); void load(); }}>إعادة المحاولة</button></div> : null}
      {!loading && !loadError && items.length === 0 ? <div className="glass card"><p className="muted">لا يوجد قراء بعد. أضف أول قارئ من النموذج أعلاه.</p></div> : null}
      <div className="grid">{items.map(r => <article className="glass card" key={r.id}><h3>{r.nameAr}</h3><p>{r.nameEn}</p><p>{r.provider} · {r.quality ?? '—'}</p><p>الحالة: {STATUS_AR[r.sourceVerificationStatus] ?? r.sourceVerificationStatus} · {r.active ? 'مفعل' : 'غير مفعل'}</p><p><a href={r.legalSourceUrl} target="_blank" rel="noreferrer">المصدر الرسمي/القانوني</a></p><div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}><button className="btn" type="button" onClick={() => edit(r)} disabled={saving}>تعديل</button><button className="btn secondary" type="button" onClick={() => void remove(r.id)} disabled={removingId === r.id}>{removingId === r.id ? 'جارٍ الحذف...' : 'حذف'}</button></div></article>)}</div>
    </section>
  </main>;
}
