export interface EmailProvider { send(input:{to:string;subject:string;html:string}):Promise<{id:string}> }
export class ConfiguredEmailProvider implements EmailProvider {
  async send(input:{to:string;subject:string;html:string}) {
    const key=process.env.RESEND_API_KEY; if(!key) throw new Error("EMAIL_PROVIDER_NOT_CONFIGURED");
    const from=process.env.EMAIL_FROM; if(!from) throw new Error("EMAIL_FROM_NOT_CONFIGURED");
    const response=await fetch("https://api.resend.com/emails",{method:"POST",headers:{Authorization:`Bearer ${key}`,"Content-Type":"application/json"},body:JSON.stringify({from,to:input.to,subject:input.subject,html:input.html})});
    const data=await response.json() as any; if(!response.ok) throw new Error(String(data?.message || "EMAIL_PROVIDER_ERROR"));
    return {id:String(data.id)};
  }
}
