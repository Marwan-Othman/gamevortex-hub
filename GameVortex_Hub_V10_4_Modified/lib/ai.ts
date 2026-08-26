export type AiMessage = { role:"system"|"user"|"assistant"; content:string };

function cleanUserPrompt(value:string) {
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").trim().slice(0, 4000);
}

export async function aiChat(messages:AiMessage[]) {
  const base = process.env.AI_PROVIDER_BASE_URL;
  const key = process.env.AI_PROVIDER_API_KEY;
  if (!base || !key) throw new Error("AI_PROVIDER_NOT_CONFIGURED");
  const safe = messages.map((m, i) => ({ role:m.role, content:i === 0 && m.role === "system" ? m.content.slice(0,4000) : cleanUserPrompt(m.content) }));
  const response = await fetch(`${base.replace(/\/$/, "")}/chat/completions`, {
    method:"POST", headers:{Authorization:`Bearer ${key}`,"Content-Type":"application/json"},
    body:JSON.stringify({ model:process.env.AI_MODEL || "default", messages:safe, temperature:0.2, max_tokens:Number(process.env.AI_MAX_OUTPUT_TOKENS || 800) })
  });
  const data = await response.json() as any;
  if (!response.ok) throw new Error(String(data?.error?.message || "AI_PROVIDER_ERROR"));
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new Error("AI_EMPTY_RESPONSE");
  return content;
}
