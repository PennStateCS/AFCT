// InputGroup.tsx
'use client';

import * as React from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { CheckCircle, XCircle, Eye, EyeOff } from 'lucide-react';
import { cn } from '@/lib/utils';

type RHFFieldProps =
  | Pick<
      React.InputHTMLAttributes<HTMLInputElement>,
      'name' | 'onChange' | 'onBlur' | 'value' | 'ref'
    >
  | Record<string, never>;

interface InputGroupProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'type'> {
  label: string;
  name: string;
  fieldProps?: RHFFieldProps;
  error?: string;
  description?: string;
  showStatus?: boolean;
  isValid?: boolean;
  isChecking?: boolean | string;
  showEye?: boolean;
  requiredMark?: boolean;
  className?: string;
  setValue?: (val: string) => void;
  type?: string;

  /** Back-compat (won't be forwarded to DOM) */
  isPasswordVisible?: boolean;
  togglePasswordVisibility?: () => void;
}

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
    requiredMark,
    className,
    setValue,

    // back-compat (do not forward)
    isPasswordVisible,
    togglePasswordVisibility,

    type = 'text',
    id,
    value,
    onBlur,
    placeholder,
    disabled,
    ...rest // <- safe now; back-compat props were pulled out above
  },
  _ref,
) {
  const inputId = id ?? name;

  // RHF wiring
  const rhfName = (fieldProps as any)?.name as string | undefined;
  const rhfValue = (fieldProps as any)?.value as any;
  const rhfOnChange = (fieldProps as any)?.onChange as ((e: any) => void) | undefined;
  const rhfOnBlur = (fieldProps as any)?.onBlur as ((e: any) => void) | undefined;
  const rhfRef = (fieldProps as any)?.ref as React.Ref<HTMLInputElement> | undefined;

  // Password visibility
  const [pwdVisibleInternal, setPwdVisibleInternal] = React.useState(false);
  const isPasswordType = type === 'password';
  const pwdVisible =
    typeof isPasswordVisible === 'boolean' ? isPasswordVisible : pwdVisibleInternal;
  const handleTogglePwd = () => {
    if (typeof isPasswordVisible === 'boolean') togglePasswordVisibility?.();
    else setPwdVisibleInternal((s) => !s);
  };
  const effectiveType = showEye && isPasswordType ? (pwdVisible ? 'text' : 'password') : type;

  // Right adornments -> padding
  const hasStatus = !!showStatus;
  const hasEye = !!showEye && isPasswordType;
  const inputPaddingRight = hasStatus && hasEye ? 'pr-16' : hasStatus || hasEye ? 'pr-10' : '';

  // Unified handlers
  const handleChange = (evt: React.ChangeEvent<HTMLInputElement>) => {
    if (rhfOnChange) return rhfOnChange(evt);
    if (setValue) return setValue(evt.target.value);
  };
  const handleBlur = (evt: React.FocusEvent<HTMLInputElement>) => {
    if (rhfOnBlur) return rhfOnBlur(evt);
    if (onBlur) return onBlur(evt);
  };

  const currValue = rhfValue ?? value ?? '';

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
          id={inputId}
          name={rhfName ?? name}
          ref={rhfRef as any}
          type={effectiveType}
          value={currValue}
          onChange={handleChange}
          onBlur={handleBlur}
          placeholder={placeholder}
          disabled={disabled}
          aria-invalid={!!error || undefined}
          aria-describedby={describedByIds || undefined}
          className={cn(inputPaddingRight)}
          {...rest}
        />

        {/* status + eye */}
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
                onClick={handleTogglePwd}
                aria-label={pwdVisible ? 'Hide password' : 'Show password'}
                className="text-muted-foreground transition-opacity hover:opacity-80"
              >
                {pwdVisible ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </>
        )}

        {/* status only */}
        {hasStatus && !hasEye && (
          <div className="absolute inset-y-0 right-3 flex items-center">
            <StatusAdornment
              isChecking={isChecking}
              isValid={isValid}
              hasValue={String(currValue).length > 0}
            />
          </div>
        )}

        {/* eye only */}
        {!hasStatus && hasEye && (
          <div className="absolute inset-y-0 right-3 flex items-center">
            <button
              type="button"
              onClick={handleTogglePwd}
              aria-label={pwdVisible ? 'Hide password' : 'Show password'}
              className="text-muted-foreground transition-opacity hover:opacity-80"
            >
              {pwdVisible ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>
        )}
      </div>

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
  if (isChecking)
    return (
      <span className="text-muted-foreground text-xs italic">
        {typeof isChecking === 'string' ? isChecking : 'Checking...'}
      </span>
    );
  if (!hasValue || isValid === undefined) return null;
  return isValid ? (
    <CheckCircle size={18} className="text-green-600" aria-label="Valid" />
  ) : (
    <XCircle size={18} className="text-red-500" aria-label="Invalid" />
  );
}

export default InputGroup;
