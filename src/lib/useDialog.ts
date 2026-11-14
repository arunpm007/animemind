'use client';

import { useEffect, useRef } from 'react';

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'textarea:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/**
 * Make a dialog behave like one for a keyboard.
 *
 * `role="dialog"` and `aria-modal` are a promise about behaviour, and the
 * modals here were not keeping it: Tab walked straight out of the search
 * palette into the page behind it, where a sighted mouse user sees a dimmed
 * overlay and a keyboard user is simply lost — operating controls they cannot
 * see, with no way back.
 *
 * Three things, all of which a real dialog owes you:
 *
 *  - focus moves INTO the dialog on open, so the next keystroke lands there
 *  - Tab and Shift+Tab cycle within it rather than escaping
 *  - focus RETURNS to whatever opened it on close, so the page does not
 *    silently reset you to the top
 *
 * The page behind is also marked inert, which hides it from screen readers
 * instead of letting them read through the overlay.
 */
export function useDialog(ref: React.RefObject<HTMLElement | null>) {
  const opener = useRef<HTMLElement | null>(null);

  useEffect(() => {
    opener.current = document.activeElement as HTMLElement | null;
    const node = ref.current;
    if (!node) return;

    // Focus the first thing worth typing into; fall back to the dialog itself.
    const first = node.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? node).focus({ preventScroll: true });

    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Tab' || !node) return;
      const items = Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      );
      if (!items.length) return;

      const firstItem = items[0];
      const lastItem = items[items.length - 1];
      const active = document.activeElement;

      // Wrap at both ends rather than letting focus leave the dialog.
      if (e.shiftKey && (active === firstItem || !node.contains(active))) {
        e.preventDefault();
        lastItem.focus();
      } else if (!e.shiftKey && active === lastItem) {
        e.preventDefault();
        firstItem.focus();
      }
    }

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      // Put the user back where they were. Without this the browser drops
      // focus to <body> and the next Tab starts from the top of the page.
      opener.current?.focus?.({ preventScroll: true });
    };
  }, [ref]);
}

/**
 * Roving focus for a menu.
 *
 * `role="menu"` tells a screen reader to expect arrow-key navigation. Our
 * status menu declared the role and then did not implement it, which is worse
 * than having no role: the user is told how to drive it and then it does not
 * respond.
 */
export function useMenuKeys(
  ref: React.RefObject<HTMLElement | null>,
  onClose: () => void,
) {
  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    function items() {
      // role^="menuitem" — NOT role="menuitem". An exact match misses
      // menuitemradio and menuitemcheckbox, which here is every status
      // option, every rating button and the favourite toggle: arrow keys
      // reached two of eighteen items and silently skipped the rest.
      return Array.from(
        node!.querySelectorAll<HTMLElement>('[role^="menuitem"]:not([disabled])'),
      ).filter((el) => el.offsetParent !== null);
    }

    function onKeyDown(e: KeyboardEvent) {
      const list = items();
      if (!list.length) return;
      const i = list.indexOf(document.activeElement as HTMLElement);

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          list[(i + 1 + list.length) % list.length].focus();
          break;
        case 'ArrowUp':
          e.preventDefault();
          list[(i - 1 + list.length) % list.length].focus();
          break;
        case 'Home':
          e.preventDefault();
          list[0].focus();
          break;
        case 'End':
          e.preventDefault();
          list[list.length - 1].focus();
          break;
        case 'Escape':
          e.preventDefault();
          onClose();
          break;
      }
    }

    node.addEventListener('keydown', onKeyDown);
    return () => node.removeEventListener('keydown', onKeyDown);
  }, [ref, onClose]);
}
