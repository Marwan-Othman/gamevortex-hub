import { db } from './prisma';
export async function getRankings(category:string, limit=12){
  const base={where:{published:true},take:Math.min(Math.max(limit,1),50)} as const;
  if(category==='top-rated') return db.game.findMany({...base,orderBy:[{ratingAverage:'desc'},{ratingCount:'desc'}]});
  if(category==='most-played') return db.game.findMany({...base,orderBy:{playCount:'desc'}});
  if(category==='rising') return db.game.findMany({...base,orderBy:{updatedAt:'desc'}});
  return db.game.findMany({...base,orderBy:[{featured:'desc'},{viewCount:'desc'}]});
}
