export type GamingIdentity={provider:"STEAM"|"PLAYSTATION"|"XBOX";providerUserId:string;displayName?:string};
export interface GamingIntegration { provider:GamingIdentity["provider"]; getIdentity(accessToken:string):Promise<GamingIdentity>; getOwnedGames(accessToken:string):Promise<Array<{providerGameId:string;title:string;minutesPlayed?:number}>>; }

export class SteamIntegration implements GamingIntegration {
  provider="STEAM" as const;
  private base="https://api.steampowered.com";
  async getIdentity(accessToken:string){ const key=process.env.STEAM_API_KEY; if(!key) throw new Error("STEAM_API_KEY_NOT_CONFIGURED"); const url=`${this.base}/ISteamUser/GetPlayerSummaries/v0002/?key=${encodeURIComponent(key)}&steamids=${encodeURIComponent(accessToken)}`; const r=await fetch(url); if(!r.ok) throw new Error("STEAM_IDENTITY_FAILED"); const d=await r.json() as any; const p=d?.response?.players?.[0]; if(!p) throw new Error("STEAM_USER_NOT_FOUND"); return {provider:"STEAM" as const,providerUserId:String(p.steamid),displayName:p.personaname}; }
  async getOwnedGames(accessToken:string){ const key=process.env.STEAM_API_KEY; if(!key) throw new Error("STEAM_API_KEY_NOT_CONFIGURED"); const url=`${this.base}/IPlayerService/GetOwnedGames/v0001/?key=${encodeURIComponent(key)}&steamid=${encodeURIComponent(accessToken)}&include_appinfo=1&include_played_free_games=1&format=json`; const r=await fetch(url); if(!r.ok) throw new Error("STEAM_LIBRARY_FAILED"); const d=await r.json() as any; return (d?.response?.games||[]).map((g:any)=>({providerGameId:String(g.appid),title:String(g.name||g.appid),minutesPlayed:Number(g.playtime_forever||0)})); }
}

export class ConfiguredGamingIntegration implements GamingIntegration {
  constructor(public provider:GamingIdentity["provider"]) {}
  async getIdentity(accessToken:string){ return this.request("identity", accessToken) as Promise<GamingIdentity>; }
  async getOwnedGames(accessToken:string){ return this.request("games", accessToken) as Promise<Array<{providerGameId:string;title:string;minutesPlayed?:number}>>; }
  private async request(kind:string, accessToken:string){ const base=process.env[`${this.provider}_API_BASE_URL`]; if(!base) throw new Error(`${this.provider}_NOT_CONFIGURED`); const r=await fetch(`${base.replace(/\/$/,"")}/${kind}`,{headers:{Authorization:`Bearer ${accessToken}`}}); const d=await r.json() as any; if(!r.ok) throw new Error(String(d?.error||`${this.provider}_${kind.toUpperCase()}_FAILED`)); return d; }
}

export function gamingProvider(provider:GamingIdentity["provider"]):GamingIntegration { return provider === "STEAM" ? new SteamIntegration() : new ConfiguredGamingIntegration(provider); }
