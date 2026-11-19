/**
 * Cover-art URLs. Regression from 19 Nov: searching "Tokyo" returned a Kitsu
 * title whose poster was a 15-minute pre-signed Backblaze link; next/image threw
 * on the unconfigured host and the whole search screen crashed.
 */
import { describe, expect, it } from 'vitest';
import { isAllowedImage } from '@/lib/image-hosts';
import { kitsuImageUrl, normaliseKitsuWork } from '@/server/providers/kitsu';

const SIGNED =
  'https://kitsu-production-media.s3.us-west-002.backblazeb2.com/anime/49926/poster_image/d235ae6acb8ca997e034d975c258824a.jpg' +
  '?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Expires=900&X-Amz-Signature=abc';

describe('kitsuImageUrl', () => {
  it('rewrites a pre-signed storage link to the permanent CDN path', () => {
    expect(kitsuImageUrl(SIGNED)).toBe(
      'https://media.kitsu.app/anime/49926/poster_image/d235ae6acb8ca997e034d975c258824a.jpg',
    );
  });

  it('keeps CDN links, minus any query string', () => {
    expect(kitsuImageUrl('https://media.kitsu.app/anime/1/poster_image/large-x.jpeg?123')).toBe(
      'https://media.kitsu.app/anime/1/poster_image/large-x.jpeg',
    );
  });

  it('drops anything else rather than storing it', () => {
    expect(kitsuImageUrl('https://evil.example/x.jpg')).toBeNull();
    expect(kitsuImageUrl('not a url')).toBeNull();
    expect(kitsuImageUrl(null)).toBeNull();
  });

  it('is applied by the Kitsu normaliser to posters and banners', () => {
    const work = normaliseKitsuWork({
      id: '49926',
      type: 'anime',
      attributes: {
        canonicalTitle: 'Ninja to Gokudou',
        titles: { en_jp: 'Ninja to Gokudou' },
        posterImage: { large: SIGNED },
        coverImage: { large: SIGNED.replace('poster_image', 'cover_image') },
      },
    } as Parameters<typeof normaliseKitsuWork>[0]);
    expect(work.coverUrl).toMatch(/^https:\/\/media\.kitsu\.app\/anime\/49926\/poster_image\//);
    expect(work.bannerUrl).toMatch(/^https:\/\/media\.kitsu\.app\/anime\/49926\/cover_image\//);
  });
});

describe('isAllowedImage', () => {
  it('accepts the configured hosts over https', () => {
    expect(isAllowedImage('https://media.kitsu.app/a.jpg')).toBe(true);
    expect(isAllowedImage('https://cdn.myanimelist.net/images/anime/1.jpg')).toBe(true);
  });

  it('rejects anything that would make next/image throw', () => {
    expect(isAllowedImage(SIGNED)).toBe(false);
    expect(isAllowedImage('http://media.kitsu.app/a.jpg')).toBe(false);
    expect(isAllowedImage('https://media.kitsu.app.evil.example/a.jpg')).toBe(false);
    expect(isAllowedImage('/local.jpg')).toBe(false);
    expect(isAllowedImage(null)).toBe(false);
  });
});
