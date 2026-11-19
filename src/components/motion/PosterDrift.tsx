import Image from 'next/image';
import { isAllowedImage } from '@/lib/image-hosts';

/**
 * A slow, faded ribbon of the viewer's own posters behind a page heading.
 *
 * Pure CSS (see .loop-x in globals.css): no JavaScript, and it stops under
 * reduced motion. Decorative only — hidden from assistive tech, and it
 * renders nothing until there are enough covers to fill a row without
 * obvious repetition.
 */
export function PosterDrift({ covers }: { covers: (string | null | undefined)[] }) {
  const list = [...new Set(covers.filter(isAllowedImage))];
  if (list.length < 2) return null;
  // Pad short lists so one copy is always wider than the screen.
  const row = Array.from({ length: Math.max(10, list.length) }, (_, i) => list[i % list.length]);

  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-x-0 -top-10 h-[340px] overflow-hidden opacity-[0.22]"
      style={{
        maskImage: 'linear-gradient(to bottom, black 20%, transparent 95%), linear-gradient(to right, transparent, black 15%, black 85%, transparent)',
        maskComposite: 'intersect',
        WebkitMaskImage: 'linear-gradient(to bottom, black 20%, transparent 95%)',
      }}
    >
      <div className="flex w-max -rotate-6 pt-6 [scale:1.1]">
        <div className="loop-x flex w-max gap-4" style={{ '--loop-dur': '120s' } as React.CSSProperties}>
          {[...row, ...row].map((src, i) => (
            <div key={i} className="relative aspect-[2/3] w-[130px] shrink-0 overflow-hidden rounded-lg">
              <Image src={src} alt="" fill sizes="130px" className="object-cover" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
