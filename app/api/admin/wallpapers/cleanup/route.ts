import { NextResponse } from "next/server";
import { getOptionalUser } from "@/lib/auth";
import { guardMutation, internalError } from "@/lib/api";
import { del } from "@vercel/blob";
export const runtime="nodejs";
export async function POST(request:Request){
  const guard=await guardMutation(request,"admin-wallpaper-cleanup",20); if(guard)return guard;
  const user=await getOptionalUser(); if(!user)return NextResponse.json({error:"Unauthorized"},{status:401}); if(user.role!=="SUPER_ADMIN")return NextResponse.json({error:"Forbidden"},{status:403});
  try{
    const body=(await request.json().catch(()=>null)) as {url?:unknown}|null;
    const url=typeof body?.url==="string"?body.url.trim():"";
    let host="";try{const u=new URL(url);host=u.protocol==="https:"?u.hostname:"";}catch{host="";}
    if(!host||!host.endsWith(".blob.vercel-storage.com"))return NextResponse.json({success:false},{status:400});
    await del(url);
    return NextResponse.json({success:true});
  }catch(error){return internalError("admin:wallpapers:cleanup",error,"CLEANUP_FAILED");}
}
