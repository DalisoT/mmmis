import * as React from 'react';
import { cn } from '@/lib/utils';
import { Input } from './input';

type CommonProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type' | 'inputMode' | 'pattern'>;

interface MoneyInputProps extends CommonProps {
  /** If true, allow a leading minus sign (refunds / negative cash). */
  allowNegative?: boolean;
}

/**
 * Mobile-friendly currency input.
 *
 * Renders a `type="text"` field with `inputMode="decimal"` so phones
 * surface the numeric keypad with a decimal separator. The `pattern`
 * attribute restricts paste to digits and at most one decimal point.
 *
 * The 16px font size on phone prevents iOS Safari from zooming the
 * viewport when the field receives focus.
 */
export const MoneyInput = React.forwardRef<HTMLInputElement, MoneyInputProps>(
  ({ className, allowNegative = false, ...props }, ref) => (
    <Input
      ref={ref}
      type="text"
      inputMode="decimal"
      autoComplete="off"
      className={cn(
        // 16px on phone prevents iOS auto-zoom; smaller on tablet+ via md:
        'text-base md:text-sm',
        className
      )}
      pattern={allowNegative ? '^-?[0-9]*\.?[0-9]*$' : '^[0-9]*\.?[0-9]*$'}
      {...props}
    />
  )
);
MoneyInput.displayName = 'MoneyInput';

interface NumberInputProps extends CommonProps {
  /** If true, allow a leading minus sign. */
  allowNegative?: boolean;
}

/** Mobile-friendly integer input (numeric keypad, no decimal). */
export const NumberInput = React.forwardRef<HTMLInputElement, NumberInputProps>(
  ({ className, allowNegative = false, ...props }, ref) => (
    <Input
      ref={ref}
      type="text"
      inputMode="numeric"
      autoComplete="off"
      className={cn('text-base md:text-sm', className)}
      pattern={allowNegative ? '^-?[0-9]*$' : '^[0-9]*$'}
      {...props}
    />
  )
);
NumberInput.displayName = 'NumberInput';

interface SearchInputProps extends CommonProps {}

/** Search input — same as `Input` but with the right autoComplete + type. */
export const SearchInput = React.forwardRef<HTMLInputElement, SearchInputProps>(
  ({ className, ...props }, ref) => (
    <Input
      ref={ref}
      type="search"
      autoComplete="off"
      className={cn('text-base md:text-sm', className)}
      {...props}
    />
  )
);
SearchInput.displayName = 'SearchInput';
