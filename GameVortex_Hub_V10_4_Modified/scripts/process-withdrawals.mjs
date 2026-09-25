import { PrismaClient } from '@prisma/client';
const db=new PrismaClient();
async function payout(input){
  const base=process.env.PAYOUT_PROVIDER_BASE_URL, secret=process.env.PAYOUT_PROVIDER_SECRET;
  if(!base||!secret) throw new Error('PAYOUT_PROVIDER_NOT_CONFIGURED');
  const r=await fetch(`${base.replace(/\/$/,'')}/payouts`,{method:'POST',headers:{Authorization:`Bearer ${secret}`,'Content-Type':'application/json','Idempotency-Key':input.withdrawalId},body:JSON.stringify(input)});
  const d=await r.json(); if(!r.ok) throw new Error(String(d?.error||'PAYOUT_PROVIDER_ERROR')); return d;
}
const rows=await db.withdrawalRequest.findMany({where:{status:'PENDING'},include:{ownerWallet:{include:{owner:true}}},take:25,orderBy:{createdAt:'asc'}});
for(const w of rows){
  try{
    if(!process.env.OWNER_EXTERNAL_WALLET_ADDRESS) throw new Error('OWNER_EXTERNAL_WALLET_ADDRESS_NOT_CONFIGURED');
    await db.withdrawalRequest.update({where:{id:w.id},data:{status:'PROCESSING',provider:process.env.PAYOUT_PROVIDER||'external'}});
    const result=await payout({withdrawalId:w.id,amount:Number(w.usdAmount),currency:w.currency,destination:process.env.OWNER_EXTERNAL_WALLET_ADDRESS});
    const paid=result.status==='PAID';
    await db.$transaction(async tx=>{
      await tx.withdrawalRequest.update({where:{id:w.id},data:{status:paid?'PAID':'PROCESSING',providerTransactionId:String(result.providerTransactionId||result.id||'')}});
      await tx.ownerLedger.create({data:{walletId:w.ownerWalletId,type:paid?'PAYOUT_SETTLED':'PAYOUT_PENDING',points:-w.points,usdAmount:w.usdAmount,currency:w.currency,conversionRate:w.conversionRate,withdrawalId:w.id,provider:process.env.PAYOUT_PROVIDER||'external',providerTransactionId:String(result.providerTransactionId||result.id||''),idempotencyKey:`${w.id}:${paid?'settled':'pending'}`}});
      if(paid) await tx.ownerWallet.update({where:{id:w.ownerWalletId},data:{pendingPoints:{decrement:w.points}}});
    });
    console.log(JSON.stringify({withdrawalId:w.id,status:paid?'PAID':'PROCESSING'}));
  }catch(error){
    const reason=error instanceof Error?error.message:'PAYOUT_FAILED';
    await db.$transaction(async tx=>{
      await tx.withdrawalRequest.update({where:{id:w.id},data:{status:'FAILED',failureReason:reason,processedAt:new Date()}});
      await tx.ownerWallet.update({where:{id:w.ownerWalletId},data:{pendingPoints:{decrement:w.points},availablePoints:{increment:w.points}}});
      await tx.ownerLedger.create({data:{walletId:w.ownerWalletId,type:'PAYOUT_FAILED',points:0,usdAmount:w.usdAmount,currency:w.currency,conversionRate:w.conversionRate,withdrawalId:w.id,provider:process.env.PAYOUT_PROVIDER||'external',idempotencyKey:`${w.id}:failed`}});
    });
    console.error(JSON.stringify({withdrawalId:w.id,status:'FAILED',reason}));
  }
}
await db.$disconnect();
