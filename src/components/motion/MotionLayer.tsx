'use client';

import { usePathname } from 'next/navigation';
import { useEffect } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

/**
 * App-wide motion that pages get for free, without becoming client components.
 *
 *   - Posters tilt toward the pointer and catch a glare (desktop pointers only).
 *   - Sections below the fold rise in as they scroll into view.
 *
 * Both are progressive: with JavaScript off or reduced motion on, nothing is
 * hidden and nothing moves. Reveals only ever START from hidden inside GSAP,
 * so content can never be left invisible by a script that did not run.
 */
export function MotionLayer() {
  const pathname = usePathname();

  // Poster tilt: one delegated listener instead of one per poster.
  useEffect(() => {
    const fine = matchMedia('(pointer: fine) and (prefers-reduced-motion: no-preference)');
    if (!fine.matches) return;

    let current: HTMLElement | null = null;
    const reset = (el: HTMLElement) => {
      el.style.removeProperty('--rx');
      el.style.removeProperty('--ry');
      el.removeAttribute('data-tilting');
    };
    const onMove = (e: PointerEvent) => {
      const el = (e.target as Element | null)?.closest<HTMLElement>('.poster');
      if (current && current !== el) reset(current);
      current = el ?? null;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width;
      const py = (e.clientY - r.top) / r.height;
      el.setAttribute('data-tilting', '');
      el.style.setProperty('--rx', `${(0.5 - py) * 14}deg`);
      el.style.setProperty('--ry', `${(px - 0.5) * 14}deg`);
      el.style.setProperty('--gx', `${px * 100}%`);
      el.style.setProperty('--gy', `${py * 100}%`);
    };
    const onLeave = () => {
      if (current) reset(current);
      current = null;
    };
    document.addEventListener('pointermove', onMove, { passive: true });
    document.documentElement.addEventListener('pointerleave', onLeave);
    return () => {
      document.removeEventListener('pointermove', onMove);
      document.documentElement.removeEventListener('pointerleave', onLeave);
    };
  }, []);

  // Scroll reveals, re-armed on every navigation.
  useEffect(() => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const content = document.getElementById('content');
    if (!content) return;

    const ctx = gsap.context(() => {
      const targets = gsap.utils
        .toArray<HTMLElement>('section', content)
        // Anything already on screen is handled by the page-enter animation.
        .filter((s) => s.getBoundingClientRect().top > innerHeight * 0.9);
      // Short pages have nothing below the fold; GSAP warns on an empty set.
      if (targets.length === 0) return;
      gsap.set(targets, { opacity: 0, y: 48 });
      ScrollTrigger.batch(targets, {
        start: 'top 92%',
        once: true,
        onEnter: (batch) =>
          gsap.to(batch, { opacity: 1, y: 0, duration: 0.9, ease: 'expo.out', stagger: 0.08, clearProps: 'transform' }),
      });
    }, content);

    // Lazy images change heights after the first layout.
    const id = window.setTimeout(() => ScrollTrigger.refresh(), 400);
    return () => {
      window.clearTimeout(id);
      ctx.revert();
    };
  }, [pathname]);

  return null;
}
