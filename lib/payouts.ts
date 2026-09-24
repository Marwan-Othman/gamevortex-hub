export type PayoutResult = { provider:string; providerTransactionId:string; status:"PROCESSING"|"PAID" };

export async function createPayout(input:{withdrawalId:string;amount:number;currency:string;destination:string}):Promise<PayoutResult> {
  const base=process.env.PAYOUT_PROVIDER_BASE_URL; const secret=process.env.PAYOUT_PROVIDER_SECRET;
  if (!base || !secret) throw new Error("PAYOUT_PROVIDER_NOT_CONFIGURED");
  const r=await fetch(`${base.replace(/\/$/,"")}/payouts`,{method:"POST",headers:{Authorization:`Bearer ${secret}`,"Content-Type":"application/json","Idempotency-Key":input.withdrawalId},body:JSON.stringify(input)});
  const d=await r.json() as any; if(!r.ok) throw new Error(String(d?.error||"PAYOUT_PROVIDER_ERROR"));
  return {provider:String(d.provider||process.env.PAYOUT_PROVIDER||"external"),providerTransactionId:String(d.providerTransactionId||d.id),status:d.status === "PAID" ? "PAID" : "PROCESSING"};
}
