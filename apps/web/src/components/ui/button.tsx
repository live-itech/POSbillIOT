import type { ButtonHTMLAttributes } from 'react';
import { cn } from '../../lib/cn';

const variants = {
  primary: 'bg-primary text-white hover:bg-primary-ink shadow-sm shadow-violet-300/40',
  soft: 'bg-primary-soft text-primary-ink hover:brightness-95 dark:text-violet-200',
  warning: 'bg-amber-100 text-amber-800 hover:bg-amber-200',
  danger: 'bg-rose-500 text-white hover:bg-rose-600',
  ghost: 'text-ink hover:bg-primary-soft',
} as const;

const sizes = { sm: 'h-8 px-3 text-sm', md: 'h-10 px-4 text-sm', lg: 'h-12 px-5 text-base' } as const;

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: keyof typeof variants;
  size?: keyof typeof sizes;
}

export function Button({ variant = 'primary', size = 'md', className, type = 'button', ...props }: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition active:scale-[.98] disabled:pointer-events-none disabled:opacity-50',
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    />
  );
}
