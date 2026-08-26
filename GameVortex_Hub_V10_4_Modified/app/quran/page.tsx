export const dynamic = "force-dynamic";
import {db} from '../../lib/prisma';
export default async function Quran(){
  const reciters=await db.quranReciter.findMany({
    where:{active:true,sourceVerificationStatus:'VERIFIED'},
    orderBy:[{sortOrder:'asc'},{nameAr:'asc'}],
    select:{id:true,nameAr:true,nameEn:true,riwayah:true,style:true,quality:true,provider:true,legalSourceUrl:true,audioBaseUrl:true,availableSurahs:true}
  });
  return <main className="wrap" dir="rtl"><section className="glass hero"><h1>القرآن الكريم</h1><p>قراء ومصادر صوتية تم التحقق منها قبل النشر.</p></section><div className="grid">{reciters.map(r=><article className="glass card" key={r.id}><h2>{r.nameAr}</h2><p>{r.nameEn}</p><p className="muted">{r.riwayah ?? '—'} · {r.quality ?? '—'} · {r.provider}</p><audio controls preload="none" src={`${r.audioBaseUrl.replace(/\/$/,'')}/001.mp3`} /><p><a href={r.legalSourceUrl} target="_blank" rel="noreferrer">المصدر الرسمي</a></p></article>)}</div></main>;
}
