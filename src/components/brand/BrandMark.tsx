import { cn } from '@/lib/utils';

interface BrandMarkProps {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  decorative?: boolean;
}

const SIZE_CLASSES = {
  sm: 'h-6 w-6',
  md: 'h-10 w-10',
  lg: 'h-24 w-24 sm:h-28 sm:w-28',
} as const;

/** Renders the optimized MMMIS insignia for compact and hero surfaces. */
export function BrandMark({ size = 'md', className, decorative = false }: BrandMarkProps) {
  return (
    <img
      src="/logo-mark.png"
      alt={decorative ? '' : 'MMMIS insignia'}
      aria-hidden={decorative || undefined}
      className={cn('shrink-0 object-contain', SIZE_CLASSES[size], className)}
      width={size === 'sm' ? 24 : size === 'md' ? 40 : 112}
      height={size === 'sm' ? 24 : size === 'md' ? 40 : 112}
    />
  );
}

interface BrandLockupProps {
  className?: string;
  showDescription?: boolean;
}

/** Centered full logo and MMMIS identity treatment for public/auth pages. */
export function BrandLockup({ className, showDescription = true }: BrandLockupProps) {
  return (
    <div className={cn('flex flex-col items-center text-center', className)}>
      <img
        src="/logo-full.png"
        alt="MMMIS insignia"
        className="h-36 w-36 object-contain sm:h-40 sm:w-40"
        width={256}
        height={256}
      />
      <div className="mt-2 text-xl font-bold tracking-tight">MMMIS</div>
      {showDescription && (
        <div className="mt-1 max-w-xs text-sm text-muted-foreground">
          Military Mess Management Information System
        </div>
      )}
    </div>
  );
}
