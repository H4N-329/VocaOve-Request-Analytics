import { mapVocaDbResults } from '../lib/vocadb.mjs';

const ORIGIN='https://vocadb.net';
const LIMIT=120;
export default async function handler(req,res) {
  if (req.method!=='GET') {
    res.setHeader('Allow','GET');
    return res.status(405).json({error:'GETのみ対応しています。'});
  }
  const song=String(req.query?.song??'').trim();
  const artist=String(req.query?.artist??'').trim();
  if (!song || song.length>LIMIT || artist.length>LIMIT || /[\x00-\x1f]/.test(song+artist)) {
    return res.status(400).json({error:'楽曲名（120文字以内）を指定してください。'});
  }
  const u=new URL('/api/songs',ORIGIN);
  u.searchParams.set('query',song);
  u.searchParams.set('maxResults','20');
  u.searchParams.set('preferAccurateMatches','true');
  u.searchParams.set('fields','Artists,PVs,AdditionalNames');
  u.searchParams.set('lang','Japanese');
  try {
    const upstream=await fetch(u,{headers:{Accept:'application/json'},signal:AbortSignal.timeout(10000)});
    if (!upstream.ok) throw Error('upstream-'+upstream.status);
    const size=Number(upstream.headers.get('content-length')||0);
    if(size>800000) throw Error('oversized');
    const raw=await upstream.text();
    if (raw.length>800000) throw Error('oversized');
    const items=mapVocaDbResults(JSON.parse(raw),song,artist);
    res.setHeader('Cache-Control','public, s-maxage=3600, stale-while-revalidate=1800');
    res.setHeader('X-Content-Type-Options','nosniff');
    return res.status(200).json({source:'VocaDB', song, artist, candidates:items});
  } catch(error) {
    res.setHeader('Cache-Control','no-store');
    return res.status(502).json({error:'VocaDBに接続できませんでした。少し後に再試行するか、YouTube・ニコニコ検索を利用してください。'});
  }
}
