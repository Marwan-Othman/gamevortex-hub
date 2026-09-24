import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/prisma";
import { guardRead } from "@/lib/api";
export async function GET(request: NextRequest, { params }: { params: Promise<{ username: string }> }) {
  const blocked=await guardRead(request,"gamer:public"); if(blocked)return blocked;
  const {username}=await params;
  const user=await db.user.findUnique({where:{username},select:{id:true,username:true,createdAt:true,gamerProfile:true,_count:{select:{followers:true,following:true,library:true,reviews:true}}}});
  if(!user)return NextResponse.json({error:"USER_NOT_FOUND"},{status:404});
  const achievements=user.gamerProfile?await db.userAchievement.findMany({where:{profileId:user.gamerProfile.id},include:{achievement:true},orderBy:{unlockedAt:"desc"}}):[];
  const recent=await db.activity.findMany({where:{userId:user.id},include:{game:{select:{slug:true,titleAr:true,titleEn:true,coverUrl:true}}},orderBy:{createdAt:"desc"},take:10});
  return NextResponse.json({user,achievements,recent});
}
