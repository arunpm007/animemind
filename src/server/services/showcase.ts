import { and, asc, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { unscoped } from '@/server/db/client';
import { series, seriesMember, work } from '@/server/db/schema';
import { isAllowedImage } from '@/lib/image-hosts';

/**
 * Artwork for the public welcome page.
 *
 * Read from the shared catalog only — nothing here belongs to a user, so it is
 * safe to show someone who is not signed in. The catalog is whatever the app
 * has already synced, so a fresh deployment may have little of it; every
 * caller must cope with empty lists.
 */
export type ShowcasePoster = { title: string; cover: string; accent: string | null };
export type ShowcaseChain = {
  title: string;
  items: { title: string; cover: string; kind: string; year: number | null }[];
};
export type Showcase = {
  posters: ShowcasePoster[];
  banners: string[];
  chain: ShowcaseChain | null;
  catalogSize: number;
};

const TTL_MS = 10 * 60 * 1000;
let cached: { at: number; value: Showcase } | null = null;

export async function getShowcase(): Promise<Showcase> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.value;
  try {
    const value = await load();
    cached = { at: Date.now(), value };
    return value;
  } catch (err) {
    // The welcome page must render even with the database down.
    console.error('showcase failed:', err);
    return { posters: [], banners: [], chain: null, catalogSize: 0 };
  }
}

async function load(): Promise<Showcase> {
  const db = unscoped();

  const rows = await db
    .select({
      en: work.titleEnglish,
      ro: work.titleRomaji,
      cover: work.coverUrl,
      banner: work.bannerUrl,
      accent: work.accentHex,
    })
    .from(work)
    .where(and(isNotNull(work.coverUrl), inArray(work.kind, ['tv', 'movie'])))
    .orderBy(sql`${work.popularity} asc nulls last`)
    .limit(60);

  const seen = new Set<string>();
  const posters: ShowcasePoster[] = [];
  const banners: string[] = [];
  for (const r of rows) {
    const title = r.en ?? r.ro;
    if (r.banner && isAllowedImage(r.banner) && banners.length < 6) banners.push(r.banner);
    // One poster per franchise-ish title keeps the wall from repeating itself.
    const key = title.split(/[:(]/)[0].trim().toLowerCase();
    if (!r.cover || !isAllowedImage(r.cover) || seen.has(key)) continue;
    seen.add(key);
    posters.push({ title, cover: r.cover, accent: r.accent });
  }

  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(work);

  return { posters, banners, chain: await loadChain(), catalogSize: n };
}

/**
 * One real series, in watch order, to show what "it works out the rest"
 * means: the most popular series with at least four entries on its story line.
 */
async function loadChain(): Promise<ShowcaseChain | null> {
  const db = unscoped();
  const candidates = await db
    .select({ id: series.id, title: series.title })
    .from(series)
    .innerJoin(seriesMember, eq(seriesMember.seriesId, series.id))
    .innerJoin(work, eq(work.id, seriesMember.workId))
    .where(and(isNotNull(seriesMember.spineOrd), isNotNull(work.coverUrl), eq(series.ambiguous, false)))
    .groupBy(series.id, series.title)
    .having(sql`count(*) >= 4`)
    .orderBy(sql`min(${work.popularity}) asc nulls last`)
    .limit(1);
  const pick = candidates[0];
  if (!pick) return null;

  const members = await db
    .select({
      en: work.titleEnglish,
      ro: work.titleRomaji,
      cover: work.coverUrl,
      kind: work.kind,
      year: work.seasonYear,
    })
    .from(seriesMember)
    .innerJoin(work, eq(work.id, seriesMember.workId))
    .where(and(eq(seriesMember.seriesId, pick.id), isNotNull(seriesMember.spineOrd), isNotNull(work.coverUrl)))
    .orderBy(asc(seriesMember.spineOrd))
    .limit(4);

  const items = members
    .filter((m) => m.cover && isAllowedImage(m.cover))
    .map((m) => ({ title: m.en ?? m.ro, cover: m.cover!, kind: m.kind, year: m.year }));
  return items.length >= 3 ? { title: pick.title, items } : null;
}
