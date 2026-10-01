import * as D from '@radix-ui/react-dialog';
import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';

export function Modal(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  width?: string;
}) {
  return (
    <D.Root open={props.open} onOpenChange={props.onOpenChange}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-40 bg-ink/40 backdrop-blur-sm" />
        <D.Content
          className={cn(
            'fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl bg-surface p-5 text-ink shadow-xl',
            props.width ?? 'max-w-md',
          )}
        >
          <D.Title className="mb-4 text-lg font-bold">{props.title}</D.Title>
          <D.Description className="sr-only">{props.title}</D.Description>
          {props.children}
          {props.footer && <div className="mt-5 flex justify-end gap-2">{props.footer}</div>}
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
