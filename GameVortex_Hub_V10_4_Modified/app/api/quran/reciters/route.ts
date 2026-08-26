import {NextResponse} from 'next/server';
import {db} from '../../../../lib/prisma';
export async function GET(){
  const reciters=await db.quranReciter.findMany({
    where:{active:true,sourceVerificationStatus:'VERIFIED'},
    orderBy:[{sortOrder:'asc'},{nameAr:'asc'}],
    select:{id:true,nameAr:true,nameEn:true,riwayah:true,style:true,quality:true,provider:true,legalSourceUrl:true,audioBaseUrl:true,availableSurahs:true}
  });
  return NextResponse.json(reciters,{headers:{'Cache-Control':'public, s-maxage=300, stale-while-revalidate=900'}});
}
