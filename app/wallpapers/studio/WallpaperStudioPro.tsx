"use client";

import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";

const W = 1080;
const H = 1920;
type Target = "home" | "lock" | "both";
type Template = { id: string; name: string; description: string; overlay: string; accent: string };
type Layer = { id: string; kind: "clock" | "date" | "hijri" | "name" | "title"; text: string; x: number; y: number; size: number; color: string; opacity: number; visible: boolean };
type SavedDesign = { id: string; name: string; background: string; layers: Layer[]; templateId: string; effect: "none" | "dim" | "vignette" | "grain"; target: Target; createdAt: string };

const templates: Template[] = [
  { id: "cyber", name: "Cyber Neon", description: "نيون + ساعة رقمية + هوية Gaming", overlay: "rgba(20,70,150,.18)", accent: "#67e8f9" },
  { id: "minimal", name: "Minimal", description: "نظيف وهادئ للشاشة الرئيسية", overlay: "rgba(0,0,0,.12)", accent: "#ffffff" },
  { id: "esports", name: "Esports", description: "اسم اللاعب + لقب احترافي", overlay: "rgba(130,20,50,.20)", accent: "#fb7185" },
  { id: "islamic", name: "Hijri", description: "التاريخ الهجري بتصميم هادئ", overlay: "rgba(20,100,75,.18)", accent: "#86efac" },
];

function id() { return crypto.randomUUID(); }
function dates() {
  const now = new Date();
  return {
    clock: new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false }).format(now),
    date: new Intl.DateTimeFormat("en-US", { weekday: "short", day: "numeric", month: "short" }).format(now).toUpperCase(),
    hijri: new Intl.DateTimeFormat("ar-SA-u-ca-islamic", { day: "numeric", month: "long", year: "numeric" }).format(now),
  };
}
function defaultLayers(name: string): Layer[] {
  const d = dates();
  return [
    { id: id(), kind: "clock", text: d.clock, x: 540, y: 620, size: 170, color: "#fff", opacity: 1, visible: true },
    { id: id(), kind: "date", text: d.date, x: 540, y: 770, size: 42, color: "#fff", opacity: .9, visible: true },
    { id: id(), kind: "hijri", text: d.hijri, x: 540, y: 830, size: 34, color: "#fff", opacity: .78, visible: true },
    { id: id(), kind: "name", text: name || "PLAYER", x: 540, y: 1080, size: 64, color: "#fff", opacity: 1, visible: true },
  ];
}

const SAVED_KEY = "gamevortex:wallpaper-studio:designs:v1";

export default function WallpaperStudioPro({ library }: { library: { id: string; title: string; src: string; isVip: boolean }[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const imageUrlRef = useRef<string | null>(null);
  const [background, setBackground] = useState(library[0]?.src ?? "");
  const [layers, setLayers] = useState<Layer[]>(() => defaultLayers("PLAYER"));
  const [selected, setSelected] = useState<string | null>(null);
  const [name, setName] = useState("PLAYER");
  const [target, setTarget] = useState<Target>("lock");
  const [tab, setTab] = useState<"templates" | "design" | "saved">("templates");
  const [template, setTemplate] = useState<Template>(templates[0]);
  const [status, setStatus] = useState("");
  const [drag, setDrag] = useState<{ id: string; dx: number; dy: number } | null>(null);
  const [effect, setEffect] = useState<"none" | "dim" | "vignette" | "grain">("none");
  const [savedDesigns, setSavedDesigns] = useState<SavedDesign[]>([]);

  const selectedLayer = useMemo(() => layers.find((x) => x.id === selected) ?? null, [layers, selected]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(SAVED_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) setSavedDesigns(parsed);
      }
    } catch {
      setStatus("تعذر قراءة التصميمات المحفوظة من هذا الجهاز.");
    }
  }, []);
  useEffect(() => () => { if (imageUrlRef.current) URL.revokeObjectURL(imageUrlRef.current); }, []);

  function draw() {
    const canvas = canvasRef.current; const ctx = canvas?.getContext("2d"); if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, W, H); ctx.fillStyle = "#080b12"; ctx.fillRect(0, 0, W, H);
    const finish = () => {
      ctx.fillStyle = template.overlay; ctx.fillRect(0, 0, W, H);
      if (effect === "dim") { ctx.fillStyle = "rgba(0,0,0,.34)"; ctx.fillRect(0, 0, W, H); }
      if (effect === "vignette") { const g = ctx.createRadialGradient(W/2,H/2,250,W/2,H/2,1050); g.addColorStop(0,"transparent"); g.addColorStop(1,"rgba(0,0,0,.76)"); ctx.fillStyle=g; ctx.fillRect(0,0,W,H); }
      if (effect === "grain") { const pixels=ctx.getImageData(0,0,W,H); for(let i=0;i<pixels.data.length;i+=4){const n=(Math.random()-.5)*18; pixels.data[i]+=n; pixels.data[i+1]+=n; pixels.data[i+2]+=n;} ctx.putImageData(pixels,0,0); }
      layers.filter(x=>x.visible).forEach(layer=>{
        ctx.save(); ctx.globalAlpha=layer.opacity; ctx.fillStyle=layer.color; ctx.textAlign="center"; ctx.textBaseline="middle";
        ctx.font=`${layer.kind === "clock" ? 300 : 600} ${layer.size}px Arial, sans-serif`; ctx.shadowColor="rgba(0,0,0,.5)"; ctx.shadowBlur=18; ctx.fillText(layer.text,layer.x,layer.y); ctx.restore();
      });
    };
    if (!background) return finish();
    const img = new Image(); img.crossOrigin="anonymous"; img.onload=()=>{const s=Math.max(W/img.width,H/img.height); const iw=img.width*s, ih=img.height*s; ctx.drawImage(img,(W-iw)/2,(H-ih)/2,iw,ih); finish();}; img.onerror=finish; img.src=background;
  }
  useEffect(()=>{draw();},[background,layers,template,effect]);

  function applyTemplate(next: Template) { setTemplate(next); setLayers(defaultLayers(name)); setStatus(`تم تطبيق قالب ${next.name}`); }
  function updateSelected(patch: Partial<Layer>) { if (!selected) return; setLayers(x=>x.map(l=>l.id===selected?{...l,...patch}:l)); }
  function point(e: React.PointerEvent<HTMLCanvasElement>) { const r=e.currentTarget.getBoundingClientRect(); return {x:(e.clientX-r.left)/r.width*W,y:(e.clientY-r.top)/r.height*H}; }
  function pick(p:{x:number;y:number}) { for(const l of [...layers].reverse()){const s=l.size*1.5;if(Math.abs(p.x-l.x)<s*2.1&&Math.abs(p.y-l.y)<s*.9)return l.id;} return null; }
  function down(e: React.PointerEvent<HTMLCanvasElement>) { const p=point(e), hit=pick(p); setSelected(hit); if(hit){const l=layers.find(x=>x.id===hit)!;setDrag({id:hit,dx:p.x-l.x,dy:p.y-l.y});e.currentTarget.setPointerCapture(e.pointerId);} }
  function move(e: React.PointerEvent<HTMLCanvasElement>) { if(!drag)return;const p=point(e);setLayers(x=>x.map(l=>l.id===drag.id?{...l,x:p.x-drag.dx,y:p.y-drag.dy}:l)); }
  function end(){setDrag(null);}
  function upload(e: ChangeEvent<HTMLInputElement>){const f=e.target.files?.[0];if(!f||!f.type.startsWith("image/"))return;if(f.size>15*1024*1024){setStatus("الصورة أكبر من 15MB");return;}if(imageUrlRef.current)URL.revokeObjectURL(imageUrlRef.current);const u=URL.createObjectURL(f);imageUrlRef.current=u;setBackground(u);e.target.value="";}

  function persistDesigns(next: SavedDesign[]) {
    setSavedDesigns(next);
    try { localStorage.setItem(SAVED_KEY, JSON.stringify(next)); }
    catch { setStatus("تعذر حفظ التصميم. مساحة التخزين في المتصفح قد تكون ممتلئة."); }
  }
  function saveDesign() {
    if (background.startsWith("blob:")) { setStatus("هذه الصورة مرفوعة من الهاتف ولا يمكن حفظها بشكل دائم في المتصفح. استخدم خلفية من مكتبة GameVortex أو نزّل التصميم."); return; }
    const design: SavedDesign = { id:id(), name:name.trim()||"GameVortex Design", background, layers:JSON.parse(JSON.stringify(layers)), templateId:template.id, effect, target, createdAt:new Date().toISOString() };
    persistDesigns([design,...savedDesigns].slice(0,20)); setStatus("تم حفظ التصميم في «تصميماتي» على هذا الجهاز."); setTab("saved");
  }
  function loadDesign(design: SavedDesign) {
    const nextTemplate=templates.find(x=>x.id===design.templateId)||templates[0]; setBackground(design.background); setLayers(JSON.parse(JSON.stringify(design.layers))); setName(design.layers.find(x=>x.kind==="name")?.text||design.name); setTemplate(nextTemplate); setEffect(design.effect); setTarget(design.target); setSelected(null); setStatus(`تم فتح «${design.name}».`); setTab("design");
  }
  function deleteDesign(designId:string){persistDesigns(savedDesigns.filter(x=>x.id!==designId));}

  async function exportImage(){const canvas=canvasRef.current;if(!canvas)return;try{const blob=await new Promise<Blob|null>(r=>canvas.toBlob(r,"image/png",1));if(!blob){setStatus("تعذر تجهيز الصورة");return;}const file=new File([blob],`gamevortex-${target}.png`,{type:"image/png"});if("share" in navigator&&navigator.canShare?.({files:[file]})){await navigator.share({title:"GameVortex Wallpaper",files:[file]});setStatus(`تم فتح مشاركة النظام لـ ${target === "both" ? "الشاشتين" : target === "home" ? "الشاشة الرئيسية" : "شاشة القفل"}`);return;}const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=file.name;a.click();setStatus("تم تنزيل الصورة. اخترها كخلفية من إعدادات الهاتف.");}catch{setStatus("لم تكتمل المشاركة؛ يمكنك تنزيل الصورة وتعيينها من الهاتف.");}}
  return <main className="wrap" dir="rtl" style={{maxWidth:1200,paddingBottom:36}}>
    <section className="glass hero" style={{padding:18}}>
      <div style={{display:"flex",justifyContent:"space-between",gap:14,alignItems:"center",flexWrap:"wrap"}}>
        <div><p className="muted" style={{margin:0}}>GAMEVORTEX WALLPAPER STUDIO</p><h1 style={{margin:"6px 0"}}>اصنع خلفيتك الخاصة</h1><p className="muted" style={{margin:0}}>قوالب Gaming + هوية اللاعب + AI + معاينة شاشة القفل والرئيسية.</p></div>
        <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>{([['home','الرئيسية'],['lock','القفل'],['both','كلاهما']] as const).map(([v,l])=><button key={v} className={`platform-chip ${target===v?'active':''}`} onClick={()=>setTarget(v)}>{l}</button>)}<button className="btn secondary" onClick={saveDesign}>حفظ التصميم</button><button className="btn" onClick={exportImage}>تعيين / مشاركة</button></div>
      </div>
    </section>

    <section style={{display:"grid",gridTemplateColumns:"minmax(0,1fr) 380px",gap:18,marginTop:18,alignItems:"start"}}>
      <div className="glass card" style={{padding:16,display:"grid",placeItems:"center"}}>
        <div style={{width:"min(100%,390px)",background:"#07090d",padding:7,borderRadius:34,boxShadow:"0 25px 70px rgba(0,0,0,.55)"}}><canvas ref={canvasRef} width={W} height={H} onPointerDown={down} onPointerMove={move} onPointerUp={end} onPointerCancel={end} style={{display:"block",width:"100%",height:"auto",borderRadius:28,touchAction:"none"}} aria-label="معاينة خلفية الهاتف" /></div>
        <div style={{display:"flex",gap:8,marginTop:12,flexWrap:"wrap",justifyContent:"center"}}><span className="badge">{target==='both'?'الرئيسية + القفل':target==='home'?'الشاشة الرئيسية':'شاشة القفل'}</span><span className="badge">1080×1920</span></div>
      </div>

      <aside className="glass card" style={{padding:14}}>
        <div className="platform-list" style={{marginBottom:12}}>{([['templates','القوالب'],['design','التخصيص'],['saved','تصميماتي'],['ai','AI']] as const).map(([v,l])=><button key={v} className={`platform-chip ${tab===v?'active':''}`} onClick={()=>setTab(v)}>{l}</button>)}</div>
        {tab==='templates'&&<div style={{display:"grid",gap:9}}>{templates.map(t=><button key={t.id} onClick={()=>applyTemplate(t)} style={{textAlign:"right",padding:12,borderRadius:14,border:`1px solid ${template.id===t.id?t.accent:'rgba(255,255,255,.1)'}`,background:"rgba(255,255,255,.03)",color:"inherit",cursor:"pointer"}}><strong>{t.name}</strong><div className="muted" style={{fontSize:13,marginTop:4}}>{t.description}</div></button>)}<button className="btn secondary" onClick={()=>fileRef.current?.click()}>＋ صورة من الهاتف</button><input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={upload} hidden/><div className="muted" style={{fontSize:13}}>أو اختر من مكتبة GameVortex</div><div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:7}}>{library.slice(0,9).map(x=><button key={x.id} onClick={()=>setBackground(x.src)} style={{padding:0,border:0,borderRadius:9,overflow:"hidden",background:"#111"}}><img src={x.src} alt="" loading="lazy" style={{display:"block",width:"100%",aspectRatio:"9/14",objectFit:"cover"}}/></button>)}</div></div>}
        {tab==='design'&&<div style={{display:"grid",gap:10}}><label>اسم اللاعب<input className="input" value={name} maxLength={24} onChange={e=>{setName(e.target.value);setLayers(x=>x.map(l=>l.kind==='name'?{...l,text:e.target.value}:l));}}/></label><label>التأثير<select className="input" value={effect} onChange={e=>setEffect(e.target.value as typeof effect)}><option value="none">بدون</option><option value="dim">تعتيم</option><option value="vignette">Vignette</option><option value="grain">Grain</option></select></label>{selectedLayer?<div style={{display:"grid",gap:8,borderTop:"1px solid rgba(255,255,255,.1)",paddingTop:10}}><label>النص<input className="input" value={selectedLayer.text} onChange={e=>updateSelected({text:e.target.value})}/></label><label>الحجم<input type="range" min="20" max="220" value={selectedLayer.size} onChange={e=>updateSelected({size:Number(e.target.value)})}/></label><label>الشفافية<input type="range" min=".1" max="1" step=".05" value={selectedLayer.opacity} onChange={e=>updateSelected({opacity:Number(e.target.value)})}/></label><input type="color" value={selectedLayer.color} onChange={e=>updateSelected({color:e.target.value})}/><button className="btn secondary" onClick={()=>updateSelected({visible:!selectedLayer.visible})}>{selectedLayer.visible?'إخفاء العنصر':'إظهار العنصر'}</button></div>:<p className="muted">اضغط على الساعة أو النص داخل المعاينة لتحديده وتحريكه.</p>}<button className="btn secondary" onClick={()=>setLayers(defaultLayers(name))}>إعادة التصميم</button></div>}
        {tab==='saved'&&<div style={{display:"grid",gap:10}}><div className="badge">تصميماتي على هذا الجهاز</div>{savedDesigns.length===0?<div className="muted" style={{lineHeight:1.7}}>لا توجد تصميمات محفوظة بعد. استخدم «حفظ التصميم» بعد اختيار خلفية من مكتبة GameVortex.</div>:savedDesigns.map(d=><div key={d.id} style={{display:"grid",gridTemplateColumns:"64px minmax(0,1fr) auto",gap:10,alignItems:"center",padding:8,border:"1px solid rgba(255,255,255,.1)",borderRadius:12}}><div style={{width:64,height:88,borderRadius:8,overflow:"hidden",background:"#111"}}><img src={d.background} alt="" style={{width:"100%",height:"100%",objectFit:"cover"}}/></div><div style={{minWidth:0}}><strong style={{display:"block",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{d.name}</strong><span className="muted" style={{fontSize:12}}>{new Date(d.createdAt).toLocaleString("ar")}</span></div><div style={{display:"grid",gap:5}}><button className="btn secondary" onClick={()=>loadDesign(d)}>فتح</button><button className="btn secondary" onClick={()=>deleteDesign(d.id)}>حذف</button></div></div>)}</div>}
        {status&&<div className="badge" style={{marginTop:12,display:"block",whiteSpace:"normal"}}>{status}</div>}
      </aside>
    </section>

    <section className="glass card" style={{marginTop:18,padding:16}}><div style={{display:"flex",justifyContent:"space-between",gap:10,flexWrap:"wrap"}}><div><strong>اختيار الخلفية النهائية</strong><div className="muted" style={{fontSize:13,marginTop:4}}>حدد الهدف قبل التصدير: شاشة القفل، الرئيسية، أو كلاهما.</div></div><button className="btn" onClick={exportImage}>جاهز — مشاركة / تنزيل</button></div></section>
    <style jsx>{`@media(max-width:820px){section[style*="grid-template-columns:minmax(0,1fr) 380px"]{grid-template-columns:1fr!important}}label{display:grid;gap:6px;font-size:14px}.input{width:100%}`}</style>
  </main>;
}
