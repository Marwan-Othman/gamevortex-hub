"use client";

import { upload } from "@vercel/blob/client";
import { useMemo, useRef, useState } from "react";
import BulkGameUploadForm from "./BulkGameUploadForm";
import {
  DEFAULT_UPLOAD_SOURCE_STATUS,
  gameContentTypeFor,
  GAME_FILE_ACCEPT,
  UPLOAD_PLATFORM_OPTIONS,
  buildBlobPathname,
  checkGameFile,
  formatBytes,
  hasAllowedGameExtension,
  slugify,
  type UploadKind,
} from "@/lib/game-upload-shared";

type Category = { id: string; nameAr: string; nameEn: string };
type Props = { categories: Category[] };

export default function GameUploadForm({ categories }: Props) {
  const [titleAr,setTitleAr]=useState(""); const [titleEn,setTitleEn]=useState(""); const [slug,setSlug]=useState("");
  const [description,setDescription]=useState(""); const [platforms,setPlatforms]=useState<string[]>([]);
  const [categoryIds,setCategoryIds]=useState<string[]>([]); const [price,setPrice]=useState("0"); const [discount,setDiscount]=useState("0");
  const [published,setPublished]=useState(true); const [rightsConfirmed,setRightsConfirmed]=useState(false);
  const [gameFile,setGameFile]=useState<File|null>(null); const [coverFile,setCoverFile]=useState<File|null>(null);
  const [hasMod,setHasMod]=useState(false); const [modFile,setModFile]=useState<File|null>(null);
  const [modTitleAr,setModTitleAr]=useState(""); const [modTitleEn,setModTitleEn]=useState(""); const [modDescription,setModDescription]=useState("");
  const [progress,setProgress]=useState(0); const progressRef=useRef({done:0,total:1}); const [busy,setBusy]=useState(false); const [status,setStatus]=useState<string|null>(null); const [error,setError]=useState<string|null>(null);
  const generatedSlug=useMemo(()=>slugify(titleEn||titleAr),[titleEn,titleAr]);

  function toggle(value:string,setter:(next:string[])=>void,current:string[]) {
    setter(current.includes(value)?current.filter((item)=>item!==value):[...current,value]);
  }

  async function uploadOne(file:File,kind:UploadKind) {
    if(kind!=="cover"){
      const issue=checkGameFile(file);
      if(issue==="UNSUPPORTED_EXTENSION") throw new Error(kind==="mod" ? "صيغة ملف الـMod غير مدعومة." : "صيغة ملف اللعبة غير مدعومة.");
      if(issue==="EMPTY_FILE") throw new Error("الملف فارغ.");
      if(issue==="TOO_LARGE") throw new Error("حجم الملف أكبر من الحد المسموح.");
    }
    const isCover=kind==="cover";
    const mimeType=isCover?(file.type||"application/octet-stream"):gameContentTypeFor(file.name);
    const blob=await upload(buildBlobPathname(kind,file.name,crypto.randomUUID()),file,{
      access:"public", handleUploadUrl:"/api/admin/games/upload", multipart:!isCover,
      ...(isCover?{}:{contentType:mimeType}),
      clientPayload:JSON.stringify({kind,mimeType,size:file.size}),
      onUploadProgress(event){
        const {done,total}=progressRef.current;
        const value=Math.min(100,Math.round(((done+file.size*event.percentage/100)/total)*100));
        setProgress((current)=>Math.max(current,value));
      },
    });
    progressRef.current.done+=file.size;
    return blob;
  }

  async function submit(event:React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(null); setStatus(null);
    const finalSlug=slugify(slug||generatedSlug);
    if(!titleAr.trim()||!titleEn.trim()||!finalSlug) return setError("أدخل اسم اللعبة بالعربية والإنجليزية.");
    if(!gameFile) return setError("اختر ملف اللعبة من الهاتف.");
    if(!hasAllowedGameExtension(gameFile.name)) return setError("صيغة ملف اللعبة غير مدعومة.");
    if(!platforms.length) return setError("اختر منصة واحدة على الأقل.");
    if(!rightsConfirmed) return setError("يجب تأكيد أن لديك حق توزيع ملف اللعبة.");
    if(hasMod && !modFile) return setError("اختر ملف الـMod أو عطّل خيار إضافة Mod.");
    setBusy(true); setProgress(0);
    progressRef.current={done:0,total:Math.max(1,gameFile.size+(coverFile?coverFile.size:0)+(hasMod&&modFile?modFile.size:0))};
    let uploadedGameUrl=""; let uploadedCoverUrl=""; let uploadedModUrl="";

    try {
      setStatus("جاري رفع ملف اللعبة مباشرة إلى التخزين...");
      const gameBlob=await uploadOne(gameFile,"game");
      uploadedGameUrl=gameBlob.url;
      let coverUrl="";
      if(coverFile){
        setStatus("جاري رفع صورة الغلاف...");
        const coverBlob=await uploadOne(coverFile,"cover");
        coverUrl=coverBlob.url; uploadedCoverUrl=coverBlob.url;
      }
      let modDownloadUrl="";
      if(hasMod && modFile){
        setStatus("جاري رفع ملف الـMod مباشرة إلى التخزين...");
        const modBlob=await uploadOne(modFile,"mod");
        uploadedModUrl=modBlob.url;
        modDownloadUrl=modBlob.url;
      }
      setStatus("جاري إنشاء اللعبة وربط الـMod...");
      const response=await fetch("/api/admin/games",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({
        titleAr:titleAr.trim(),titleEn:titleEn.trim(),slug:finalSlug,descriptionAr:description.trim()||undefined,
        platforms,categoryIds,price:Number(price||0),discount:Number(discount||0),coverUrl:coverUrl||undefined,
        downloadSource:gameBlob.url,sourceStatus:DEFAULT_UPLOAD_SOURCE_STATUS,published,featured:false,
        mod: hasMod && modFile ? {
          titleAr:(modTitleAr.trim()||`${titleAr.trim()} Mod`),
          titleEn:(modTitleEn.trim()||`${titleEn.trim()} Mod`),
          descriptionAr:modDescription.trim()||undefined,
          downloadUrl:modDownloadUrl,
          sourceStatus:DEFAULT_UPLOAD_SOURCE_STATUS,
          published,
          platform:platforms[0],
        } : undefined,
      })});
      const payload=await response.json().catch(()=>null);
      if(!response.ok||!payload?.success) throw new Error(payload?.error||"تعذر حفظ اللعبة.");
      setStatus("تمت إضافة اللعبة والـMod بنجاح. ");
      setTitleAr("");setTitleEn("");setSlug("");setDescription("");setPlatforms([]);setCategoryIds([]);setPrice("0");setDiscount("0");setPublished(true);setRightsConfirmed(false);setGameFile(null);setCoverFile(null);setHasMod(false);setModFile(null);setModTitleAr("");setModTitleEn("");setModDescription("");setProgress(100);
      for(const id of ["game-file-input","cover-file-input","mod-file-input"]){const input=document.getElementById(id) as HTMLInputElement|null;if(input)input.value="";}
    } catch(err){
      if(uploadedGameUrl || uploadedCoverUrl || uploadedModUrl){
        try{
          await fetch("/api/admin/games/upload",{method:"DELETE",headers:{"Content-Type":"application/json"},body:JSON.stringify({urls:[uploadedGameUrl,uploadedCoverUrl,uploadedModUrl].filter(Boolean)})});
        }catch{}
      }
      setError(err instanceof Error?err.message:"حدث خطأ أثناء إضافة اللعبة.");
    } finally{setBusy(false);}
  }

  return (
    <>
      <BulkGameUploadForm categories={categories} />
      <section className="glass card" style={{marginBottom:20}}>
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
        <div><strong>الفئات</strong><div style={{display:"flex",gap:8,flexWrap:"wrap",marginTop:8}}>
          {categories.map((category)=><button key={category.id} type="button" aria-pressed={categoryIds.includes(category.id)} className={categoryIds.includes(category.id)?"btn":"btn secondary"} onClick={()=>toggle(category.id,setCategoryIds,categoryIds)}>{category.nameAr}</button>)}
        </div></div>
      </div>
      <label>الوصف<textarea value={description} onChange={(e)=>setDescription(e.target.value)} rows={4} placeholder="وصف اللعبة..."/></label>
      <div><strong>المنصات</strong><div style={{display:"flex",gap:8,flexWrap:"wrap",marginTop:8}}>
        {UPLOAD_PLATFORM_OPTIONS.map(([value,label])=><button key={value} type="button" className={platforms.includes(value)?"btn":"btn secondary"} onClick={()=>toggle(value,setPlatforms,platforms)}>{label}</button>)}
      </div></div>
      <div className="grid" style={{gridTemplateColumns:"repeat(auto-fit,minmax(250px,1fr))",gap:12}}>
        <label>ملف اللعبة *<input id="game-file-input" type="file" accept={GAME_FILE_ACCEPT} onChange={(e)=>setGameFile(e.target.files?.[0]||null)} required/>{gameFile&&<small className="muted">{gameFile.name} · {formatBytes(gameFile.size)}</small>}</label>
        <label>صورة الغلاف (اختياري)<input id="cover-file-input" type="file" accept="image/jpeg,image/png,image/webp,image/avif" onChange={(e)=>setCoverFile(e.target.files?.[0]||null)}/>{coverFile&&<small className="muted">{coverFile.name} · {formatBytes(coverFile.size)}</small>}</label>
      </div>
      <label style={{display:"flex",gap:8,alignItems:"center"}}><input type="checkbox" checked={hasMod} onChange={(e)=>setHasMod(e.target.checked)}/> إضافة Mod لهذه اللعبة</label>
      {hasMod&&<div className="glass card" style={{display:"grid",gap:12}}>
        <h3 style={{margin:0}}>ملف الـMod</h3>
        <div className="grid" style={{gridTemplateColumns:"repeat(auto-fit,minmax(220px,1fr))",gap:12}}>
          <label>اسم الـMod بالعربية<input value={modTitleAr} onChange={(e)=>setModTitleAr(e.target.value)} placeholder={`${titleAr||"اسم اللعبة"} Mod`}/></label>
          <label>اسم الـMod بالإنجليزية<input value={modTitleEn} onChange={(e)=>setModTitleEn(e.target.value)} placeholder={`${titleEn||"Game"} Mod`}/></label>
        </div>
        <label>وصف الـMod<textarea value={modDescription} onChange={(e)=>setModDescription(e.target.value)} rows={3}/></label>
        <label>ملف الـMod *<input id="mod-file-input" type="file" accept={GAME_FILE_ACCEPT} onChange={(e)=>setModFile(e.target.files?.[0]||null)} required={hasMod}/>{modFile&&<small className="muted">{modFile.name} · {formatBytes(modFile.size)}</small>}</label>
      </div>}
      <label style={{display:"flex",gap:8,alignItems:"center"}}><input type="checkbox" checked={published} onChange={(e)=>setPublished(e.target.checked)}/> نشر اللعبة بعد الحفظ</label>
      <label style={{display:"flex",gap:8,alignItems:"flex-start"}}><input type="checkbox" checked={rightsConfirmed} onChange={(e)=>setRightsConfirmed(e.target.checked)}/> أؤكد أن ملف اللعبة مملوك لي أو لدي ترخيص/حق قانوني لتوزيعه على GameVortex.</label>
      {busy&&<><progress value={progress} max={100}/><small className="muted">الرفع المباشر قد يعيد محاولة أجزاء من الملف عند ضعف الاتصال؛ لذلك لن يعود المؤشر للخلف.</small></>}
      {status&&<p style={{padding:"10px 12px",borderRadius:10,background:"rgba(34,197,94,.12)"}}>{status}</p>}
      {error&&<p style={{padding:"10px 12px",borderRadius:10,background:"rgba(239,68,68,.12)"}}>{error}</p>}
      <button className="btn" type="submit" disabled={busy}>{busy?`جاري العمل... ${progress}%`:"رفع ونشر اللعبة"}</button>
    </form>
  </section>
    </>
  );
}
