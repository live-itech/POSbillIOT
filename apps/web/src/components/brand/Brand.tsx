import type { OutletType } from '@funplay/shared';
import { cn } from '../../lib/cn';

/** Logo FunPlay; versi gelap otomatis saat mode gelap aktif. */
export function Logo({ className }: { className?: string }) {
  return (
    <>
      <img src="/brand/logo-light.png" alt="FunPlay" className={cn('w-auto dark:hidden', className)} />
      <img src="/brand/logo-dark.png" alt="FunPlay" className={cn('hidden w-auto dark:block', className)} />
    </>
  );
}

export function UnitTypeIcon({ outletType, className }: { outletType: OutletType; className?: string }) {
  const src = outletType === 'PLAYSTATION' ? '/brand/icon-playstation.png' : '/brand/icon-billiard.png';
  return <img src={src} alt="" aria-hidden className={cn('inline-block h-5 w-auto', className)} />;
}

export function Illustration({ name, className }: { name: 'empty-units' | 'empty-device-offline'; className?: string }) {
  return <img src={`/brand/${name}.webp`} alt="" aria-hidden className={cn('mx-auto h-auto', className)} />;
}
