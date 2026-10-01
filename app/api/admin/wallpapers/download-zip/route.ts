import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getOptionalUser } from "@/lib/auth";
import { guardMutation } from "@/lib/api";
import { del } from "@vercel/blob";
import { openWallpaperSource } from "@/lib/wallpaper-delivery";
import { WALLPAPER_BULK_DOWNLOAD_MAX, WALLPAPER_BULK_DOWNLOAD_MAX_BYTES } from "@/lib/wallpaper-constants";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function u16(v:number){ const b=new Uint8Array(2); new DataView(b.buffer).setUint16(0,v,true); return b; }
function u32(v:number){ const b=new Uint8Array(4); new DataView(b.buffer).setUint32(0,v>>>0,true); return b; }
function concat(...parts:Uint8Array[]){ const n=parts.reduce((a,b)=>a+b.byteLength,0); const out=new Uint8Array(n); let o=0; for(const p of parts){out.set(p,o);o+=p.byteLength;} return out; }
function crc32(data:Uint8Array){ let c=0xffffffff; for(const byte of data){ c ^= byte; for(let k=0;k<8;k++) c=(c>>>1)^((c&1)?0xedb88320:0); } return (c^0xffffffff)>>>0; }
async function bytes(url:string){ const opened=await openWallpaperSource(url); const b=new Uint8Array(await new Response(opened.stream).arrayBuffer()); if(b.byteLength>WALLPAPER_BULK_DOWNLOAD_MAX_BYTES) throw new Error("FILE_TOO_LARGE"); return b; }

export async function POST(request:Request){
  const guard=await guardMutation(request,"admin-wallpaper-zip",10); if(guard)return guard;
  const user=await getOptionalUser(); if(!user)return NextResponse.json({error:"Unauthorized"},{status:401}); if(user.role!=="SUPER_ADMIN")return NextResponse.json({error:"Forbidden"},{status:403});
  try{
    const body=await request.json() as {ids?:unknown};
    const ids=Array.from(new Set<string>(Array.isArray(body.ids)?body.ids.filter((x):x is string=>typeof x==="string").map(x=>x.trim()).filter(Boolean):[])).slice(0,WALLPAPER_BULK_DOWNLOAD_MAX);
    if(!ids.length)return NextResponse.json({error:"No wallpapers selected"},{status:400});
    const rows=await prisma.wallpaper.findMany({where:{id:{in:ids}},select:{id:true,imageUrl:true,mediaUrl:true,mediaType:true,originalFilename:true,mimeType:true},orderBy:{createdAt:"asc"}});
    const chunks:Uint8Array[]=[]; const central:Uint8Array[]=[]; let offset=0,total=0,count=0;
    for(const row of rows){
      const target=row.mediaType==="VIDEO"&&row.mediaUrl?row.mediaUrl:row.imageUrl;
      const data=await bytes(target); total+=data.byteLength; if(total>WALLPAPER_BULK_DOWNLOAD_MAX_BYTES) throw new Error("ZIP_SIZE_LIMIT");
      const name=(row.originalFilename||`wallpaper-${row.id}`).replace(/[^a-zA-Z0-9._-]+/g,"-").slice(0,120)||`wallpaper-${row.id}`;
      const nameBytes=new TextEncoder().encode(name);
      const crc=crc32(data);
      const lh=concat(new TextEncoder().encode("PK\x03\x04"),u16(20),u16(0),u16(0),u16(0),u16(0),u32(crc),u32(data.byteLength),u32(data.byteLength),u16(nameBytes.length),u16(0),nameBytes);
      chunks.push(lh,data);
      const ch=concat(new TextEncoder().encode("PK\x01\x02"),u16(20),u16(20),u16(0),u16(0),u16(0),u16(0),u32(crc),u32(data.byteLength),u32(data.byteLength),u16(nameBytes.length),u16(0),u16(0),u16(0),u16(0),u32(0),u32(offset),nameBytes);
      central.push(ch); offset+=lh.byteLength+data.byteLength; count++;
    }
    const centralBytes=central.reduce((a,b)=>a+b.byteLength,0);
    const end=concat(new TextEncoder().encode("PK\x05\x06"),u16(0),u16(0),u16(count),u16(count),u32(centralBytes),u32(offset),u16(0));
    const all=concat(...chunks,...central,end);
    await prisma.wallpaper.updateMany({where:{id:{in:rows.map(r=>r.id)}},data:{downloadCount:{increment:1}}});
    return new Response(all,{status:200,headers:{"Content-Type":"application/zip","Content-Disposition":"attachment; filename=\"gamevortex-wallpapers.zip\"","Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff","Content-Length":String(all.byteLength)}});
  }catch(error){ console.error("Wallpaper ZIP error",error); return NextResponse.json({error:error instanceof Error?error.message:"Failed to build ZIP"},{status:400}); }
}
