import Link from "next/link";
import { db } from "@/lib/prisma";
import { GAME_PLATFORMS, getPlatformSlugFromEnum } from "@/lib/platforms";
import LocaleText from "@/components/ui/LocaleText";

export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ q?: string; platform?: string; category?: string; sort?: string; page?: string }> };

export default async function AppsPage({ searchParams }: Props) {
  const p = await searchParams; const q=(p.q||"").trim().slice(0,80); const platform=(p.platform||"").trim(); const category=(p.category||"").trim(); const sort=["rating","popular","newest","views"].includes(p.sort||"")?p.sort!:"newest"; const page=Math.max(1,Number(p.page)||1); const limit=24;
  const where:any={published:true};
  if(q) where.OR=[{nameAr:{contains:q,mode:"insensitive"}},{nameEn:{contains:q,mode:"insensitive"}},{developer:{contains:q,mode:"insensitive"}}];
  if(platform){const map:any={pc:"PC",playstation:"PLAYSTATION",xbox:"XBOX",nintendo:"NINTENDO",android:"ANDROID",ios:"IOS",mac:"MAC",linux:"LINUX","steam-deck":"STEAM_DECK",web:"WEB"}; if(map[platform]) where.appPlatforms={some:{platform:map[platform]}};}
  if(category) where.appCategories={some:{category:{OR:[{slug:category.toLowerCase()},{nameAr:{equals:category,mode:"insensitive"}},{nameEn:{equals:category,mode:"insensitive"}}]}}};
  const orderBy=sort==="rating"?[{featured:"desc" as const},{ratingAverage:"desc" as const},{ratingCount:"desc" as const}]:sort==="popular"?[{downloadCount:"desc" as const},{viewCount:"desc" as const}]:sort==="views"?[{viewCount:"desc" as const},{downloadCount:"desc" as const}]:[{createdAt:"desc" as const},{id:"desc" as const}];
  const [apps,total,categories]=await Promise.all([db.app.findMany({where,orderBy,skip:(page-1)*limit,take:limit,include:{appPlatforms:true,appCategories:{include:{category:true}}}}),db.app.count({where}),db.category.findMany({where:{active:true},orderBy:[{sortOrder:"asc"},{nameEn:"asc"}],select:{slug:true,nameAr:true,nameEn:true},take:30})]);
  const pages=Math.ceil(total/limit);
  const href=(next:number)=>{const s=new URLSearchParams();if(q)s.set("q",q);if(platform)s.set("platform",platform);if(category)s.set("category",category);if(sort!=="newest")s.set("sort",sort);if(next>1)s.set("page",String(next));return `/apps${s.toString()?`?${s}`:""}`};
  return <main className="wrap"><section className="glass hero"><p className="muted">GAMEVORTEX APP HUB</p><LocaleText as="h1" ar="التطبيقات" en="Apps"/><p><LocaleText as="span" ar="قسم مستقل للتطبيقات، منظم حسب المنصة والتصنيف، بدون خلطها مع الألعاب." en="A dedicated app catalog, organized by platform and category without mixing apps with games."/></p></section>
    <section className="glass filters"><form className="filter-row" method="get"><input className="input" name="q" defaultValue={q} placeholder="ابحث عن تطبيق أو مطور…"/><select className="input" name="platform" defaultValue={platform}><option value="">كل المنصات</option>{GAME_PLATFORMS.map(x=><option key={x.slug} value={x.slug}>{x.nameAr} / {x.nameEn}</option>)}</select><select className="input" name="category" defaultValue={category}><option value="">كل التصنيفات</option>{categories.map(x=><option key={x.slug} value={x.slug}>{x.nameAr} / {x.nameEn}</option>)}</select><select className="input" name="sort" defaultValue={sort}><option value="newest">الأحدث</option><option value="rating">التقييم</option><option value="popular">الأكثر تحميلًا</option><option value="views">الأكثر مشاهدة</option></select><button className="btn" type="submit">بحث</button></form></section>
    <section className="grid">{apps.map(app=><Link href={`/apps/${app.slug}`} className="glass card" key={app.id} style={{textDecoration:"none"}}><div style={{display:"grid",gridTemplateColumns:"72px 1fr",gap:14,alignItems:"center"}}>{app.iconUrl||app.coverUrl?<img src={app.iconUrl||app.coverUrl||""} alt="" style={{width:72,height:72,objectFit:"cover",borderRadius:16}}/>:<div className="orb" style={{width:72,height:72,fontSize:30}}>◈</div>}<div><span className="badge">APP</span><h2 style={{margin:"8px 0 2px"}}>{app.nameAr}</h2><p className="muted" style={{margin:0}}>{app.nameEn}{app.developer?` · ${app.developer}`:""}</p></div></div><p>{app.descriptionAr||app.descriptionEn||"تطبيق موثق في كتالوج GameVortex."}</p><div className="tabs">{app.appPlatforms.map(x=><span className="badge" key={x.platform}>{getPlatformSlugFromEnum(x.platform)}</span>)}</div></Link>)}{!apps.length&&<section className="glass card"><h2>لا توجد نتائج</h2><p className="muted">جرّب إزالة فلتر أو تغيير عبارة البحث.</p></section>}</section>
    {pages>1&&<nav className="tabs" aria-label="صفحات التطبيقات" style={{justifyContent:"center"}}>{page>1&&<Link className="btn secondary" href={href(page-1)}>السابق</Link>}<span className="badge">{page} / {pages}</span>{page<pages&&<Link className="btn" href={href(page+1)}>التالي</Link>}</nav>}
  </main>;
}
