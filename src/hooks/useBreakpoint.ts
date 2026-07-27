import { useEffect, useState } from 'react';

/**
 * Tailwind-aligned breakpoints (in pixels).
 *
 *  sm:  640
 *  md:  768
 *  lg:  1024
 *  xl:  1280
 */
export type Breakpoint = 'base' | 'sm' | 'md' | 'lg' | 'xl' | '2xl';

const QUERIES: Array<{ name: Breakpoint; query: string }> = [
  { name: '2xl', query: '(min-width: 1536px)' },
  { name: 'xl',  query: '(min-width: 1280px)' },
  { name: 'lg',  query: '(min-width: 1024px)' },
  { name: 'md',  query: '(min-width:  768px)' },
  { name: 'sm',  query: '(min-width:  640px)' },
];

function current(): Breakpoint {
  if (typeof window === 'undefined') return 'base';
  for (const { name, query } of QUERIES) {
    if (window.matchMedia(query).matches) return name;
  }
  return 'base';
}

export function useBreakpoint(): Breakpoint {
  const [bp, setBp] = useState<Breakpoint>(current);
  useEffect(() => {
    const handler = () => setBp(current());
    handler();
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);
  return bp;
}

/** Convenience: is the current viewport smaller than a given breakpoint? */
export function useIsBelow(bp: Breakpoint): boolean {
  const order: Breakpoint[] = ['base', 'sm', 'md', 'lg', 'xl', '2xl'];
  return order.indexOf(useBreakpoint()) < order.indexOf(bp);
}

/** True on phones only (< 768px, i.e. below Tailwind's `md:`). */
export function useIsPhone(): boolean {
  return useIsBelow('md');
}

/** True on phones and tablets (< 1024px, i.e. below Tailwind's `lg:`). */
export function useIsTabletOrPhone(): boolean {
  return useIsBelow('lg');
}
