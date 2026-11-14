'use client';

import Image from 'next/image';
import { useState } from 'react';
import { ImageOff } from 'lucide-react';

/**
 * Cover art with a graceful failure.
 *
 * Provider CDN paths do rot — MyAnimeList re-hosts art and old URLs start
 * returning 404 — and a broken <img> renders as a blank grey rectangle with no
 * indication of what is missing. A poster wall of unlabelled grey boxes looks
 * like the app is broken, when in fact only the picture is gone. Falling back
 * to the title keeps the wall usable and keeps the failure legible.
 */
export function PosterImage({
  src,
  title,
  sizes,
  priority,
  quiet,
}: {
  src: string | null;
  title: string;
  sizes?: string;
  priority?: boolean;
  /**
   * The title is already visible next to this poster.
   *
   * In a grid the text fallback IS the identification, so it has to be the
   * title. In a list row the title sits two centimetres to the right, so the
   * same fallback prints the name twice in a row — and at 52px wide, clamped
   * to 10px, the copy inside the box is the illegible one. A neutral mark
   * reads as "no art" without the stutter.
   */
  quiet?: boolean;
}) {
  const [broken, setBroken] = useState(false);

  if (!src || broken) {
    return (
      <div className="flex size-full items-center justify-center p-2 text-center">
        {quiet ? (
          <ImageOff aria-hidden className="size-4 text-[var(--color-border-strong)]" />
        ) : (
          <span className="line-clamp-4 text-[10px] leading-tight text-[var(--color-mute)]">
            {title}
          </span>
        )}
      </div>
    );
  }

  return (
    <Image
      src={src}
      alt=""
      fill
      sizes={sizes ?? '(max-width: 640px) 45vw, 200px'}
      priority={priority}
      onError={() => setBroken(true)}
      className="object-cover transition-[transform,filter] duration-[420ms] ease-[var(--ease-enter)] group-hover:brightness-110"
    />
  );
}
