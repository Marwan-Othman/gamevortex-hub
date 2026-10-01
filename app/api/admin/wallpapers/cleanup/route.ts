import { NextResponse } from "next/server";
import { getOptionalUser } from "@/lib/auth";
import { guardMutation } from "@/lib/api";
import { del } from "@vercel/blob";
export const runtime="nodejs";
export async function POST(request:Request){
  const guard=await guardMutation(request,"admin-wallpaper-cleanup",20); if(guard)return guard;
  const user=await getOptionalUser(); if(!user)return NextResponse.json({error:"Unauthorized"},{status:401}); if(user.role!=="SUPER_ADMIN")return NextResponse.json({error:"Forbidden"},{status:403});
  try{
    const body=await request.json() as {url?:unknown};
    const url=typeof body.url==="string"?body.url.trim():"";
    if(!url||!url.startsWith("https://")||!url.includes(".blob.vercel-storage.com"))return NextResponse.json({success:false},{status:400});
    await del(url);
    return NextResponse.json({success:true});
  }catch(error){return NextResponse.json({success:false,error:"Cleanup failed"},{status:400});}
}
