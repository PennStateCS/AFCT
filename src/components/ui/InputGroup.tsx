'use client';

import * as React from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { CheckCircle, XCircle, Eye, EyeOff } from 'lucide-react';
import { cn } from '@/lib/utils';

/* ---------------- Types ---------------- */

type RHFFieldProps =
  | {
      name?: string;
      onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
      onBlur?: (e: React.FocusEvent<HTMLInputElement>) => void;
      value?: string;
      ref?: React.Ref<HTMLInputElement>;
    }
  | Record<string, never>;

interface InputGroupProps extends Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  'onChange' | 'type'
> {
  label: string;
  name: string;
  labelClassName?: string;
  fieldProps?: RHFFieldProps;
  error?: string;
  description?: string;
  additionalDescribedBy?: string | string[];
  showStatus?: boolean;
  isValid?: boolean;
  isChecking?: boolean | string;
  showEye?: boolean;
  isPasswordVisible?: boolean;
  togglePasswordVisibility?: () => void;
  requiredMark?: boolean;
  setValue?: (val: string) => void;
  type?: React.HTMLInputTypeAttribute;
}

/* ================================================= */

const InputGroup = React.forwardRef<HTMLInputElement, InputGroupProps>(function InputGroup(
  {
    label,
	labelClassName = "",
    name,
    fieldProps,
    error,
    description,
    additionalDescribedBy,
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
  const labelId = `${inputId}-label`;

  const rhfName = (fieldProps as RHFFieldProps)?.name as string | undefined;
  const rhfValue = (fieldProps as RHFFieldProps)?.value as string | undefined;
  const rhfOnChange = (fieldProps as RHFFieldProps)?.onChange;
  const rhfOnBlur = (fieldProps as RHFFieldProps)?.onBlur;
  const rhfRef = (fieldProps as RHFFieldProps)?.ref;

  const [pwdVisibleInternal, setPwdVisibleInternal] = React.useState(false);
  const externallyControlled = typeof isPasswordVisible === 'boolean';
  const isPasswordish = type === 'password';

  const pwdVisible = externallyControlled ? !!isPasswordVisible : pwdVisibleInternal;

  const effectiveType = showEye && isPasswordish ? (pwdVisible ? 'text' : 'password') : type;

  const hasEye = !!showEye;
  const hasStatus = !!showStatus;

  const handleChange = (evt: React.ChangeEvent<HTMLInputElement>) => {
    if (rhfOnChange) return rhfOnChange(evt);
    if (setValue) return setValue(evt.target.value);
  };

  const handleBlur = (evt: React.FocusEvent<HTMLInputElement>) => {
    if (rhfOnBlur) return rhfOnBlur(evt);
    if (onBlur) return onBlur(evt);
  };

  const currValue = rhfValue ?? value ?? '';

  const handleToggleEye = () => {
    if (!hasEye) return;
    if (externallyControlled) {
      togglePasswordVisibility?.();
    } else {
      setPwdVisibleInternal((s) => !s);
    }
  };

  const inputPaddingRight = hasStatus && hasEye ? 'pr-16' : hasStatus || hasEye ? 'pr-10' : '';

  const describedByIds: Array<string | null> = [
    error ? `${inputId}-error` : null,
    description ? `${inputId}-desc` : null,
  ];

  if (additionalDescribedBy) {
    if (Array.isArray(additionalDescribedBy)) {
      describedByIds.push(...additionalDescribedBy);
    } else {
      describedByIds.push(additionalDescribedBy);
    }
  }

  const describedByAttr = describedByIds
    .filter((id): id is string => !!id && id.trim().length > 0)
    .join(' ')
    .trim();

  return (
    <div className={cn('flex flex-col', className)}>
      <Label id={labelId} htmlFor={inputId} className={`mb-1.5 text-sm font-medium ${labelClassName}`}>
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
          aria-labelledby={labelId}
          aria-invalid={!!error || undefined}
          aria-describedby={describedByAttr || undefined}
          className={cn(
            'h-11 transition-all duration-150',
            'focus-visible:ring-0',
			'border-black',
            error && 'border-red-500',
            type === 'number' && 'appearance-auto',
            inputPaddingRight,
			labelClassName,
          )}
        />

        {/* STATUS + EYE */}
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
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    handleToggleEye();
                  }
                }}
                aria-label={pwdVisible ? 'Hide password' : 'Show password'}
                aria-pressed={pwdVisible}
                className="text-muted-foreground transition-opacity hover:opacity-80"
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
              aria-pressed={pwdVisible}
              className="text-muted-foreground transition-opacity hover:opacity-80"
            >
              {pwdVisible ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>
        )}
      </div>

      {description && (
        <p id={`${inputId}-desc`} className="text-muted-foreground mt-1 text-xs">
          {description}
        </p>
      )}

      {error && (
        <p id={`${inputId}-error`} className="mt-1 text-xs text-red-600">
          {error}
        </p>
      )}
    </div>
  );
});

/* ---------------- Status ---------------- */

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
    <CheckCircle size={18} className="text-green-500" aria-hidden="true" />
  ) : (
    <XCircle size={18} className="text-red-500" aria-hidden="true" />
  );
}

export default InputGroup;
