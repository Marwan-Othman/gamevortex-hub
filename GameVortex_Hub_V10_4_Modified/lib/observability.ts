export function logEvent(event:string,data:Record<string,unknown>={}){const payload={ts:new Date().toISOString(),event,...data};if(process.env.NODE_ENV!=="test")console.log(JSON.stringify(payload));}
export function safeError(error:unknown){return error instanceof Error?error.message:"UNKNOWN_ERROR";}
