"use client";

import { upload } from "@vercel/blob/client";
import { useMemo, useState } from "react";

const GAME_EXTENSIONS = [".apk",".aab",".exe",".msi",".zip",".7z",".rar",".iso",".img",".dmg",".pkg",".appimage",".deb",".tar",".gz",".tgz"];
const PLATFORMS = [
  ["PC","PC"],["ANDROID","Android"],["IOS","iPhone / iPad"],["PLAYSTATION","PlayStation"],
  ["XBOX","Xbox"],["NINTENDO","Nintendo"],["MAC","macOS"],["LINUX","Linux"],["STEAM_DECK","Steam Deck"],["WEB","Web"],
] as const;
type Category = { id: string; nameAr: string; nameEn: string };
type Props = { categories: Category[] };

function slugify(value: string) {
  return value.trim().toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g,"")
    .replace(/[^a-z0-9\s-]/g,"").replace(/\s+/g,"-").replace(/-+/g,"-").replace(/^-|-$/g,"").slice(0,90);
}
function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  const units=["KB","MB","GB","TB"]; let size=value; let index=-1;
  do { size/=1024; index+=1; } while(size>=1024 && index<units.length-1);
  return `${size.toFixed(size>=10?0:1)} ${units[index]}`;
}
function gameExtension(name: string) {
  const lower=name.toLowerCase();
  return GAME_EXTENSIONS.find((extension)=>lower.endsWith(extension)) || "";
}

export default function GameUploadForm({ categories }: Props) {
  const [titleAr,setTitleAr]=useState(""); const [titleEn,setTitleEn]=useState(""); const [slug,setSlug]=useState("");
  const [description,setDescription]=useState(""); const [platforms,setPlatforms]=useState<string[]>([]);
  const [categoryIds,setCategoryIds]=useState<string[]>([]); const [price,setPrice]=useState("0"); const [discount,setDiscount]=useState("0");
  const [published,setPublished]=useState(true); const [rightsConfirmed,setRightsConfirmed]=useState(false);
  const [gameFile,setGameFile]=useState<File|null>(null); const [coverFile,setCoverFile]=useState<File|null>(null);
  const [progress,setProgress]=useState(0); const [busy,setBusy]=useState(false); const [status,setStatus]=useState<string|null>(null); const [error,setError]=useState<string|null>(null);
  const generatedSlug=useMemo(()=>slugify(titleEn||titleAr),[titleEn,titleAr]);

  function toggle(value:string,setter:(next:string[])=>void,current:string[]) {
    setter(current.includes(value)?current.filter((item)=>item!==value):[...current,value]);
  }

  async function uploadOne(file:File,kind:"game"|"cover") {
    if(kind==="game" && !gameExtension(file.name)) throw new Error("صيغة ملف اللعبة غير مدعومة.");
    const safe=file.name.normalize("NFKC").replace(/[^a-zA-Z0-9._-]+/g,"-").replace(/-+/g,"-").slice(-160);
    const pathname=`${kind==="game"?"games/files":"games/covers"}/${Date.now()}-${crypto.randomUUID()}-${safe}`;
    return upload(pathname,file,{
      access:"public", handleUploadUrl:"/api/admin/games/upload", multipart:kind==="game",
      clientPayload:JSON.stringify({kind,mimeType:file.type||"application/octet-stream",size:file.size}),
      onUploadProgress(event){setProgress(Math.round(event.percentage));},
    });
  }

  async function submit(event:React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(null); setStatus(null);
    const finalSlug=slugify(slug||generatedSlug);
    if(!titleAr.trim()||!titleEn.trim()||!finalSlug) return setError("أدخل اسم اللعبة بالعربية والإنجليزية.");
    if(!gameFile) return setError("اختر ملف اللعبة من الهاتف.");
    if(!platforms.length) return setError("اختر منصة واحدة على الأقل.");
    if(!rightsConfirmed) return setError("يجب تأكيد أن لديك حق توزيع ملف اللعبة.");
    setBusy(true); setProgress(0);
    try {
      setStatus("جاري رفع ملف اللعبة مباشرة إلى التخزين...");
      const gameBlob=await uploadOne(gameFile,"game");
      let coverUrl="";
      if(coverFile){setStatus("جاري رفع صورة الغلاف..."); const coverBlob=await uploadOne(coverFile,"cover"); coverUrl=coverBlob.url;}
      setStatus("جاري إنشاء اللعبة ونشرها...");
      const response=await fetch("/api/admin/games",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({
        titleAr:titleAr.trim(),titleEn:titleEn.trim(),slug:finalSlug,descriptionAr:description.trim()||undefined,
        platforms,categoryIds,price:Number(price||0),discount:Number(discount||0),coverUrl:coverUrl||undefined,
        downloadSource:gameBlob.url,sourceStatus:"LICENSED_FOR_DISTRIBUTION",published,featured:false,
      })});
      const payload=await response.json().catch(()=>null);
      if(!response.ok||!payload?.success) throw new Error(payload?.error||"تعذر حفظ اللعبة.");
      setStatus("تمت إضافة اللعبة بنجاح. زر التحميل أصبح متاحًا حسب حالة النشر.");
      setTitleAr("");setTitleEn("");setSlug("");setDescription("");setPlatforms([]);setCategoryIds([]);setPrice("0");setDiscount("0");setPublished(true);setRightsConfirmed(false);setGameFile(null);setCoverFile(null);setProgress(100);
      const gameInput=document.getElementById("game-file-input") as HTMLInputElement|null; const coverInput=document.getElementById("cover-file-input") as HTMLInputElement|null;
      if(gameInput) gameInput.value=""; if(coverInput) coverInput.value="";
    } catch(err){setError(err instanceof Error?err.message:"حدث خطأ أثناء إضافة اللعبة.");}
    finally{setBusy(false);}
  }

  return <section className="glass card" style={{marginBottom:20}}>
    <div style={{display:"flex",justifyContent:"space-between",gap:12,alignItems:"center",flexWrap:"wrap"}}>
      <div><span className="badge">OWNER UPLOAD</span><h2 style={{marginBottom:6}}>إضافة لعبة من الهاتف</h2><p className="muted" style={{margin:0}}>اختر ملف اللعبة مباشرة من جهازك. لا تحتاج إلى وضع رابط للعبة.</p></div>
    </div>
    <form onSubmit={submit} style={{display:"grid",gap:14,marginTop:18}}>
      <div className="grid" style={{gridTemplateColumns:"repeat(auto-fit,minmax(220px,1fr))",gap:12}}>
        <label>اسم اللعبة بالعربية<input value={titleAr} onChange={(e)=>setTitleAr(e.target.value)} required/></label>
        <label>اسم اللعبة بالإنجليزية<input value={titleEn} onChange={(e)=>{setTitleEn(e.target.value);if(!slug)setSlug(slugify(e.target.value));}} required/></label>
        <label>الرابط الداخلي (Slug)<input value={slug} onChange={(e)=>setSlug(slugify(e.target.value))} placeholder={generatedSlug||"game-name"} required/></label>
        <label>السعر بالدولار<input type="number" min="0" step="0.01" value={price} onChange={(e)=>setPrice(e.target.value)}/></label>
        <label>الخصم %<input type="number" min="0" max="100" step="1" value={discount} onChange={(e)=>setDiscount(e.target.value)}/></label>
        <label>الفئات<select multiple value={categoryIds} onChange={(e)=>setCategoryIds(Array.from(e.target.selectedOptions,(option)=>option.value))} style={{minHeight:110}}>
          {categories.map((category)=><option key={category.id} value={category.id}>{category.nameAr} / {category.nameEn}</option>)}
        </select></label>
      </div>
      <label>الوصف<textarea value={description} onChange={(e)=>setDescription(e.target.value)} rows={4} placeholder="وصف اللعبة..."/></label>
      <div><strong>المنصات</strong><div style={{display:"flex",gap:8,flexWrap:"wrap",marginTop:8}}>
        {PLATFORMS.map(([value,label])=><button key={value} type="button" className={platforms.includes(value)?"btn":"btn secondary"} onClick={()=>toggle(value,setPlatforms,platforms)}>{label}</button>)}
      </div></div>
      <div className="grid" style={{gridTemplateColumns:"repeat(auto-fit,minmax(250px,1fr))",gap:12}}>
        <label>ملف اللعبة *<input id="game-file-input" type="file" accept=".apk,.aab,.exe,.msi,.zip,.7z,.rar,.iso,.img,.dmg,.pkg,.appimage,.deb,.tar,.gz,.tgz" onChange={(e)=>setGameFile(e.target.files?.[0]||null)} required/>{gameFile&&<small className="muted">{gameFile.name} · {formatBytes(gameFile.size)}</small>}</label>
        <label>صورة الغلاف (اختياري)<input id="cover-file-input" type="file" accept="image/jpeg,image/png,image/webp,image/avif" onChange={(e)=>setCoverFile(e.target.files?.[0]||null)}/>{coverFile&&<small className="muted">{coverFile.name} · {formatBytes(coverFile.size)}</small>}</label>
      </div>
      <label style={{display:"flex",gap:8,alignItems:"center"}}><input type="checkbox" checked={published} onChange={(e)=>setPublished(e.target.checked)}/> نشر اللعبة بعد الحفظ</label>
      <label style={{display:"flex",gap:8,alignItems:"flex-start"}}><input type="checkbox" checked={rightsConfirmed} onChange={(e)=>setRightsConfirmed(e.target.checked)}/> أؤكد أن ملف اللعبة مملوك لي أو لدي ترخيص/حق قانوني لتوزيعه على GameVortex.</label>
      {busy&&<progress value={progress} max={100}/>}
      {status&&<p style={{padding:"10px 12px",borderRadius:10,background:"rgba(34,197,94,.12)"}}>{status}</p>}
      {error&&<p style={{padding:"10px 12px",borderRadius:10,background:"rgba(239,68,68,.12)"}}>{error}</p>}
      <button className="btn" type="submit" disabled={busy}>{busy?`جاري العمل... ${progress}%`:"رفع ونشر اللعبة"}</button>
    </form>
  </section>;
}
