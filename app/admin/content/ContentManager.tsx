"use client";

import { upload } from "@vercel/blob/client";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import {
  MAX_CONTENT_APK_SIZE,
  MAX_CONTENT_IMAGE_SIZE,
  buildContentBlobPath,
  canonicalContentBlobUrl,
  isApkFileName,
  isImageFileName,
} from "@/lib/content-upload-shared";

type ContentType = "GAME" | "APP";
type VersionType = "STANDARD" | "MOD";
type Platform = "PC"|"PLAYSTATION"|"XBOX"|"NINTENDO"|"ANDROID"|"IOS"|"MAC"|"LINUX"|"STEAM_DECK"|"WEB";

type Item = {
  id: string; contentType: ContentType; name: string; secondaryName: string;
  slug: string; versionType: VersionType; published: boolean; imageUrl: string | null; updatedAt: string | Date;
};

type Editing = {
  id: string; contentType: ContentType; name: string; description: string | null;
  platform: Platform; versionType: VersionType; mainImageUrl: string | null;
  screenshotUrls: string[]; downloadSource: string | null; slug: string;
};

const PLATFORM_OPTIONS: Array<[Platform,string]> = [
  ["ANDROID","Android"],["PC","PC"],["WEB","Web"],["IOS","iPhone / iPad"],["MAC","macOS"],
  ["LINUX","Linux"],["PLAYSTATION","PlayStation"],["XBOX","Xbox"],["NINTENDO","Nintendo"],["STEAM_DECK","Steam Deck"],
];

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  const units=["KB","MB","GB"]; let size=value, i=-1;
  do { size/=1024; i++; } while(size>=1024&&i<units.length-1);
  return `${size.toFixed(size>=10?0:1)} ${units[i]}`;
}

function versionLabel(value: VersionType) { return value === "MOD" ? "MOD" : "عادي"; }

export default function ContentManager({ items, editing }: { items: Item[]; editing: Editing | null }) {
  const router=useRouter();
  const [contentType,setContentType]=useState<ContentType>(editing?.contentType ?? "GAME");
  const [versionType,setVersionType]=useState<VersionType>(editing?.versionType ?? "STANDARD");
  const [name,setName]=useState(editing?.name ?? "");
  const [description,setDescription]=useState(editing?.description ?? "");
  const [platform,setPlatform]=useState<Platform>(editing?.platform ?? "ANDROID");
  const [sourceMode,setSourceMode]=useState<"UPLOAD"|"URL">("UPLOAD");
  const [apkFile,setApkFile]=useState<File|null>(null);
  const [apkUrl,setApkUrl]=useState("");
  const [mainImageUrl,setMainImageUrl]=useState(editing?.mainImageUrl ?? "");
  const [mainImageFile,setMainImageFile]=useState<File|null>(null);
  const [screenshots,setScreenshots]=useState<string[]>(editing?.screenshotUrls ?? []);
  const [screenshotFiles,setScreenshotFiles]=useState<File[]>([]);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState("");
  const [error,setError]=useState("");

  const isEditing=Boolean(editing);
  const title=isEditing?"تعديل لعبة / تطبيق":"إضافة لعبة / تطبيق";

  const existingSourceLabel=useMemo(()=>editing?.downloadSource?"يوجد APK محفوظ حاليًا":"لا يوجد APK محفوظ حاليًا",[editing]);

  function chooseScreenshots(files: File[]) {
    const accepted=files.filter((file)=>isImageFileName(file.name)&&file.size>0&&file.size<=MAX_CONTENT_IMAGE_SIZE);
    setScreenshotFiles((current)=>[...current,...accepted].slice(0,30));
  }

  async function uploadOne(file: File, kind: "apk"|"image") {
    const max=kind==="apk"?MAX_CONTENT_APK_SIZE:MAX_CONTENT_IMAGE_SIZE;
    if(file.size<=0||file.size>max) throw new Error(kind==="apk"?"حجم APK غير صالح":"حجم الصورة غير صالح");
    if(kind==="apk"&&!isApkFileName(file.name)) throw new Error("يجب اختيار ملف APK فقط.");
    if(kind==="image"&&!isImageFileName(file.name)) throw new Error("صيغة الصورة غير مدعومة.");

    const blob=await upload(buildContentBlobPath(kind,file.name),file,{
      access:"public",
      handleUploadUrl:"/api/admin/content/upload",
      multipart:kind==="apk",
      contentType:kind==="image"?file.type:"application/vnd.android.package-archive",
      clientPayload:JSON.stringify({kind,size:file.size,mimeType:kind==="image"?file.type:"application/vnd.android.package-archive"}),
    });
    const canonical=canonicalContentBlobUrl(blob.url,kind);
    if(!canonical) throw new Error("رابط التخزين غير صالح.");
    return canonical;
  }

  async function cleanup(urls:string[]) {
    if(!urls.length)return;
    try{await fetch("/api/admin/content/upload",{method:"DELETE",headers:{"content-type":"application/json"},body:JSON.stringify({urls})});}catch{}
  }

  async function submit(event:React.FormEvent) {
    event.preventDefault(); setError(""); setMessage("");
    if(!name.trim())return setError("أدخل اسم اللعبة أو التطبيق.");
    if(platform!=="ANDROID")return setError("نظام الإضافة الحالي يعتمد APK، لذلك يجب أن تكون المنصة Android.");
    if(!isEditing&&!apkFile&&!apkUrl.trim())return setError("اختر رفع APK أو ضع رابط APK واحد.");
    if(sourceMode==="UPLOAD"&&apkFile&&!isApkFileName(apkFile.name))return setError("يجب اختيار ملف APK فقط.");
    if(sourceMode==="URL"&&apkUrl.trim()&&!/^https?:\/\//i.test(apkUrl.trim()))return setError("رابط APK يجب أن يبدأ بـ http:// أو https://.");

    setBusy(true);
    const newUrls:string[]=[];
    try{
      let uploadedApk="";
      if(sourceMode==="UPLOAD"&&apkFile){
        setMessage("جاري رفع APK...");
        uploadedApk=await uploadOne(apkFile,"apk"); newUrls.push(uploadedApk);
      }

      let uploadedMain=mainImageUrl||null;
      if(mainImageFile){
        setMessage("جاري رفع الصورة الرئيسية...");
        uploadedMain=await uploadOne(mainImageFile,"image"); newUrls.push(uploadedMain);
      }

      const finalScreenshots=[...screenshots];
      for(const file of screenshotFiles){
        setMessage("جاري رفع الصور التعريفية...");
        const url=await uploadOne(file,"image"); finalScreenshots.push(url); newUrls.push(url);
      }

      const payload={
        ...(editing?.id?{id:editing.id}:{}),
        contentType,versionType,name:name.trim(),description:description.trim()||null,
        platform,sourceMode,
        apkUrl:sourceMode==="UPLOAD"?uploadedApk:apkUrl.trim(),
        mainImageUrl:uploadedMain,
        screenshotUrls:Array.from(new Set(finalScreenshots)),
        slug:editing?.slug||undefined,
      };

      setMessage("جاري حفظ المحتوى...");
      const response=await fetch("/api/admin/content",{
        method:isEditing?"PATCH":"POST",
        headers:{"content-type":"application/json"},
        body:JSON.stringify(payload),
      });
      const result=await response.json().catch(()=>null);
      if(!response.ok||!result?.success)throw new Error(result?.error||"تعذر حفظ المحتوى.");

      setMessage("تم الحفظ بنجاح.");
      router.push("/admin/content");
      router.refresh();
    }catch(error){
      await cleanup(newUrls);
      setError(error instanceof Error?error.message:"حدث خطأ غير متوقع.");
    }finally{setBusy(false);}
  }

  function removeScreenshot(url:string){setScreenshots((current)=>current.filter((item)=>item!==url));}
  function removeMainImage(){setMainImageUrl("");setMainImageFile(null);}

  return <main className="wrap" dir="rtl">
    <section className="glass hero">
      <h1>{title}</h1>
      <p className="muted">صفحة واحدة لإضافة وتعديل الألعاب والتطبيقات. جميع عمليات الإدارة محمية من الخادم لحساب SUPER_ADMIN فقط.</p>
    </section>

    <section className="glass card" style={{display:"grid",gap:16}}>
      <div className="grid" style={{gridTemplateColumns:"repeat(auto-fit,minmax(220px,1fr))",gap:12}}>
        <label>نوع المحتوى
          <select value={contentType} disabled={isEditing||busy} onChange={e=>setContentType(e.target.value as ContentType)}>
            <option value="GAME">لعبة</option><option value="APP">تطبيق</option>
          </select>
        </label>
        <label>المنصة
          <select value={platform} disabled={busy} onChange={e=>setPlatform(e.target.value as Platform)}>
            {PLATFORM_OPTIONS.map(([value,label])=><option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label>نوع النسخة
          <select value={versionType} disabled={busy} onChange={e=>setVersionType(e.target.value as VersionType)}>
            <option value="STANDARD">عادي</option><option value="MOD">MOD</option>
          </select>
        </label>
        <label>الاسم
          <input value={name} disabled={busy} onChange={e=>setName(e.target.value)} placeholder="اسم اللعبة أو التطبيق" maxLength={180} required/>
        </label>
      </div>

      <div>
        <strong>مصدر APK</strong>
        <div style={{display:"flex",gap:10,flexWrap:"wrap",marginTop:10}}>
          <button type="button" className={sourceMode==="UPLOAD"?"btn":"btn secondary"} disabled={busy} onClick={()=>setSourceMode("UPLOAD")}>رفع APK من الهاتف</button>
          <button type="button" className={sourceMode==="URL"?"btn":"btn secondary"} disabled={busy} onClick={()=>setSourceMode("URL")}>رابط APK واحد</button>
        </div>
        <p className="muted" style={{margin:"8px 0 0"}}>{existingSourceLabel}</p>
      </div>

      {sourceMode==="UPLOAD" ? <label>ملف APK
        <input type="file" accept=".apk,application/vnd.android.package-archive" disabled={busy} onChange={e=>setApkFile(e.target.files?.[0]??null)} required={!isEditing}/>
        {apkFile&&<small className="muted">{apkFile.name} · {formatBytes(apkFile.size)}</small>}
      </label> : <label>رابط APK
        <input type="url" value={apkUrl} disabled={busy} onChange={e=>setApkUrl(e.target.value)} placeholder="https://example.com/app.apk" required={!isEditing}/>
      </label>}

      <label>الصورة الرئيسية
        <input type="file" accept="image/jpeg,image/png,image/webp,image/avif" disabled={busy} onChange={e=>setMainImageFile(e.target.files?.[0]??null)}/>
      </label>
      {(mainImageUrl||mainImageFile)&&<div style={{display:"flex",alignItems:"center",gap:12,flexWrap:"wrap"}}>
        {mainImageFile?<img src={URL.createObjectURL(mainImageFile)} alt="" style={{width:100,height:100,objectFit:"cover",borderRadius:12}}/>:mainImageUrl?<img src={mainImageUrl} alt="" style={{width:100,height:100,objectFit:"cover",borderRadius:12}}/>:null}
        <button type="button" className="btn secondary" disabled={busy} onClick={removeMainImage}>حذف الصورة الرئيسية</button>
      </div>}

      <div>
        <strong>الصور التعريفية</strong>
        <input type="file" multiple accept="image/jpeg,image/png,image/webp,image/avif" disabled={busy} onChange={e=>chooseScreenshots(Array.from(e.target.files??[]))}/>
        {(screenshots.length||screenshotFiles.length)>0&&<div className="grid" style={{gridTemplateColumns:"repeat(auto-fill,minmax(120px,1fr))",gap:10,marginTop:12}}>
          {screenshots.map(url=><div key={url} style={{position:"relative"}}><img src={url} alt="" style={{width:"100%",aspectRatio:"1",objectFit:"cover",borderRadius:10}}/><button type="button" className="btn secondary" style={{width:"100%",marginTop:4}} disabled={busy} onClick={()=>removeScreenshot(url)}>حذف</button></div>)}
          {screenshotFiles.map((file,index)=><div key={`${file.name}-${file.lastModified}-${index}`}><img src={URL.createObjectURL(file)} alt="" style={{width:"100%",aspectRatio:"1",objectFit:"cover",borderRadius:10}}/><button type="button" className="btn secondary" style={{width:"100%",marginTop:4}} disabled={busy} onClick={()=>setScreenshotFiles(current=>current.filter((_,i)=>i!==index))}>حذف</button></div>)}
        </div>}
      </div>

      <label>الشرح / الوصف
        <textarea value={description} disabled={busy} onChange={e=>setDescription(e.target.value)} rows={8} maxLength={10000} placeholder="اكتب شرح اللعبة أو التطبيق بالكامل..."/>
      </label>

      {message&&<p role="status" style={{padding:12,borderRadius:10,background:"rgba(34,197,94,.12)"}}>{message}</p>}
      {error&&<p role="alert" style={{padding:12,borderRadius:10,background:"rgba(239,68,68,.12)"}}>{error}</p>}
      <button className="btn" type="submit" disabled={busy}>{busy?"جاري الحفظ...":isEditing?"حفظ التعديلات":"إضافة المحتوى"}</button>
    </section>

    <section className="glass card" style={{marginTop:16}}>
      <h2>المحتوى الموجود</h2>
      <div className="grid">
        {items.map(item=><article className="glass card" key={item.id}>
          {item.imageUrl&&<img src={item.imageUrl} alt="" style={{width:"100%",aspectRatio:"16/9",objectFit:"cover",borderRadius:10}}/>}
          <span className="badge">{item.contentType==="GAME"?"لعبة":"تطبيق"} · {versionLabel(item.versionType)}</span>
          <h3>{item.name}</h3>
          <p className="muted">{item.secondaryName} · {item.slug}</p>
          <button className="btn secondary" type="button" disabled={busy} onClick={()=>router.push(`/admin/content?id=${encodeURIComponent(item.id)}`)}>تعديل</button>
        </article>)}
        {!items.length&&<p className="muted">لا يوجد محتوى بعد.</p>}
      </div>
    </section>
  </main>;
}
