import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { guardMutation, guardRead } from "@/lib/api";
export async function GET(request: NextRequest) { const blocked = await guardRead(request, "notifications:read"); if (blocked) return blocked; try { const u=await requireUser(); return NextResponse.json(await db.notification.findMany({ where:{userId:u.id}, orderBy:{createdAt:"desc"}, take:50 })); } catch(e){ return NextResponse.json({error:e instanceof Error?e.message:"UNAUTHORIZED"},{status:401}); } }
export async function PATCH(request: NextRequest) { const blocked=await guardMutation(request,"notifications:write",30); if(blocked)return blocked; try { const u=await requireUser(); const body=await request.json(); const id=String(body.id||""); if(id){ await db.notification.updateMany({where:{id,userId:u.id},data:{readAt:new Date()}}); } else { await db.notification.updateMany({where:{userId:u.id,readAt:null},data:{readAt:new Date()}}); } return NextResponse.json({ok:true}); } catch(e){ return NextResponse.json({error:e instanceof Error?e.message:"FAILED"},{status:400}); } }
