import { useEffect, useState } from 'react';

export const BREAKPOINTS = { mobile: 640, tablet: 1024 } as const;

export type Tier = 'mobile' | 'tablet' | 'desktop';

function tierOf(width: number): Tier {
  if (width < BREAKPOINTS.mobile) return 'mobile';
  if (width < BREAKPOINTS.tablet) return 'tablet';
  return 'desktop';
}

export function useBreakpoint(): Tier {
  const [tier, setTier] = useState<Tier>(() => tierOf(window.innerWidth));
  useEffect(() => {
    const handler = () => setTier(tierOf(window.innerWidth));
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);
  return tier;
}
