'use client';

import * as React from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { CheckCircle, XCircle, Eye, EyeOff } from 'lucide-react';
import { cn } from '@/lib/utils';

/** RHF field props shape */
type RHFFieldProps =
  | {
      name?: string;
      onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
      onBlur?: (e: React.FocusEvent<HTMLInputElement>) => void;
      value?: string;
      ref?: React.Ref<HTMLInputElement>;
    }
  | Record<string, never>; // allow not using RHF

interface InputGroupProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'type'> {
  /** Visible label text */
  label: string;
  /** Field name (use the same as RHF schema key) */
  name: string;

  /** RHF field props: pass `{...field}` from Controller or `{...register('name')}` */
  fieldProps?: RHFFieldProps;

  /** Validation error message (from Zod/RHF) */
  error?: string;
  /** Optional helper/description under the field */
  description?: string;

  /** Show async/valid/invalid status area on the right */
  showStatus?: boolean;
  /** Current validity when showStatus is enabled */
  isValid?: boolean;
  /** Async checking indicator text or boolean */
  isChecking?: boolean | string;

  /** Show an eye to toggle password visibility (pass `type="password"` below) */
  showEye?: boolean;
  /**
   * OPTIONAL external control of the eye (if you need it).
   * If omitted, the eye is controlled internally.
   */
  isPasswordVisible?: boolean;
  togglePasswordVisibility?: () => void;

  /** Force required markup/ARIA; leave undefined to control via schema */
  requiredMark?: boolean;

  /** For controlled usage without RHF */
  setValue?: (val: string) => void;

  /** Override input type; defaults to 'text'. Keep as 'password' to use the eye. */
  type?: React.HTMLInputTypeAttribute;
}

/**
 * InputGroup
 * - Works with RHF (pass fieldProps={...field} and error from formState.errors)
 * - Works without RHF (pass value + setValue)
 * - Shows status icons/eye toggle and error/description text
 * - Eye stays visible when toggling (no disappearing)
 */
const InputGroup = React.forwardRef<HTMLInputElement, InputGroupProps>(function InputGroup(
  {
    label,
    name,
    fieldProps,
    error,
    description,
    showStatus,
    isValid,
    isChecking,
    showEye,
    isPasswordVisible,
    togglePasswordVisibility,
    requiredMark,
    className,
    setValue,
    type = 'text',
    id,
    value,
    onBlur,
    placeholder,
    disabled,
    ...rest
  },
  ref,
) {
  const inputId = id ?? name;

  const rhfName = (fieldProps as RHFFieldProps)?.name as string | undefined;
  const rhfValue = (fieldProps as RHFFieldProps)?.value as string | undefined;
  const rhfOnChange = (fieldProps as RHFFieldProps)?.onChange as
    | ((e: React.ChangeEvent<HTMLInputElement>) => void)
    | undefined;
  const rhfOnBlur = (fieldProps as RHFFieldProps)?.onBlur as
    | ((e: React.FocusEvent<HTMLInputElement>) => void)
    | undefined;
  const rhfRef = (fieldProps as RHFFieldProps)?.ref as React.Ref<HTMLInputElement> | undefined;

  // Internal password visibility (used if no external control provided)
  const [pwdVisibleInternal, setPwdVisibleInternal] = React.useState(false);
  const externallyControlled = typeof isPasswordVisible === 'boolean';

  // Only treat as "passwordish" if the declared prop is password.
  // (We don't rely on the current, effective type.)
  const isPasswordish = type === 'password';

  // Effective visibility
  const pwdVisible = externallyControlled ? !!isPasswordVisible : pwdVisibleInternal;

  // Compute the effective type (toggle only if it started as password)
  const effectiveType = showEye && isPasswordish ? (pwdVisible ? 'text' : 'password') : type;

  // Eye should always be visible when asked, regardless of effective type
  const hasEye = !!showEye;

  // Unified change/blur handlers: prefer RHF, then controlled, then noop
  const handleChange = (evt: React.ChangeEvent<HTMLInputElement>) => {
    if (rhfOnChange) return rhfOnChange(evt);
    if (setValue) return setValue(evt.target.value);
  };
  const handleBlur = (evt: React.FocusEvent<HTMLInputElement>) => {
    if (rhfOnBlur) return rhfOnBlur(evt);
    if (onBlur) return onBlur(evt);
  };

  // Determine current value: prefer RHF, then controlled prop `value`
  const currValue = rhfValue ?? value ?? '';

  // Toggle handler supports both internal & external control
  const handleToggleEye = () => {
    if (!hasEye) return;
    if (externallyControlled) {
      togglePasswordVisibility?.();
    } else {
      setPwdVisibleInternal((s) => !s);
    }
  };

  // Decide right padding based on adornments
  const hasStatus = !!showStatus;
  const inputPaddingRight = hasStatus && hasEye ? 'pr-16' : hasStatus || hasEye ? 'pr-10' : '';

  // aria-describedby
  const describedByIds = [error ? `${inputId}-error` : null, description ? `${inputId}-desc` : null]
    .filter(Boolean)
    .join(' ')
    .trim();

  return (
    <div className={cn('flex flex-col', className)}>
      <Label className="pb-2" htmlFor={inputId}>
        {label}
        {requiredMark ? <span className="text-red-600"> *</span> : null}
      </Label>

      <div className="relative">
        <Input
          {...rest}
          id={inputId}
          name={rhfName ?? name}
          ref={rhfRef || ref}
          type={effectiveType}
          value={currValue}
          onChange={handleChange}
          onBlur={handleBlur}
          placeholder={placeholder}
          disabled={disabled}
          aria-invalid={!!error || undefined}
          aria-describedby={describedByIds || undefined}
          className={cn(inputPaddingRight)}
        />

        {/* STATUS + EYE together */}
        {hasStatus && hasEye && (
          <>
            <div className="absolute inset-y-0 right-10 flex items-center pr-1">
              <StatusAdornment
                isChecking={isChecking}
                isValid={isValid}
                hasValue={String(currValue).length > 0}
              />
            </div>
            <div className="absolute inset-y-0 right-3 flex items-center">
              <button
                type="button"
                onClick={handleToggleEye}
                aria-label={pwdVisible ? 'Hide password' : 'Show password'}
                className="text-muted-foreground transition-opacity hover:opacity-80"
                // Keep the button even if not passwordish; it simply toggles internal state
              >
                {pwdVisible ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </>
        )}

        {/* STATUS only */}
        {hasStatus && !hasEye && (
          <div className="absolute inset-y-0 right-3 flex items-center">
            <StatusAdornment
              isChecking={isChecking}
              isValid={isValid}
              hasValue={String(currValue).length > 0}
            />
          </div>
        )}

        {/* EYE only */}
        {!hasStatus && hasEye && (
          <div className="absolute inset-y-0 right-3 flex items-center">
            <button
              type="button"
              onClick={handleToggleEye}
              aria-label={pwdVisible ? 'Hide password' : 'Show password'}
              className="text-muted-foreground transition-opacity hover:opacity-80"
            >
              {pwdVisible ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>
        )}
      </div>

      {/* Description / Error */}
      {description ? (
        <p id={`${inputId}-desc`} className="text-muted-foreground mt-1 text-xs">
          {description}
        </p>
      ) : null}
      {error ? (
        <p id={`${inputId}-error`} className="mt-1 text-xs text-red-600">
          {error}
        </p>
      ) : null}
    </div>
  );
});

function StatusAdornment({
  isChecking,
  isValid,
  hasValue,
}: {
  isChecking?: boolean | string;
  isValid?: boolean;
  hasValue: boolean;
}) {
  if (isChecking) {
    const text = typeof isChecking === 'string' ? isChecking : 'Checking...';
    return <span className="text-muted-foreground text-xs italic">{text}</span>;
  }
  if (!hasValue || isValid === undefined) return null;
  return isValid ? (
    <CheckCircle size={18} className="text-green-600" aria-label="Valid" />
  ) : (
    <XCircle size={18} className="text-red-500" aria-label="Invalid" />
  );
}

export default InputGroup;
