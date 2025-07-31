'use client';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { CheckCircle, XCircle, Eye, EyeOff } from 'lucide-react';
import React from 'react';

interface InputGroupProps {
  label: string;
  value: string;
  setValue: (val: string) => void;
  type?: string;
  showStatus?: boolean;
  isValid?: boolean;
  showEye?: boolean;
  isPasswordVisible?: boolean;
  togglePasswordVisibility?: () => void;
  isChecking?: boolean;
  onBlur?: () => void;
}

export default function InputGroup({
  label,
  value,
  setValue,
  type = 'text',
  showStatus,
  isValid,
  showEye,
  isPasswordVisible,
  togglePasswordVisibility,
  isChecking,
  onBlur,
}: InputGroupProps) {
  const inputClassName = showEye && showStatus ? 'pr-16' : showEye || showStatus ? 'pr-10' : '';

  return (
    <div className="flex flex-col">
      <Label className="pb-2">{label}</Label>
      <div className="relative">
        <Input
          type={type}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={onBlur}
          required
          className={inputClassName}
        />

        {/* Case: both status and eye icon */}
        {showStatus && showEye && (
          <>
            <div className="absolute inset-y-0 right-10 flex items-center pr-1">
              {isChecking ? (
                <span className="text-muted-foreground text-xs italic">Checking...</span>
              ) : value.length > 0 && isValid !== undefined ? (
                isValid ? (
                  <CheckCircle size={18} className="text-green-600" />
                ) : (
                  <XCircle size={18} className="text-red-500" />
                )
              ) : null}
            </div>
            <div className="absolute inset-y-0 right-3 flex items-center">
              <button type="button" onClick={togglePasswordVisibility}>
                {isPasswordVisible ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </>
        )}

        {/* Case: only status icon */}
        {showStatus && !showEye && (
          <div className="absolute inset-y-0 right-3 flex items-center">
            {isChecking ? (
              <span className="text-muted-foreground text-xs italic">Checking...</span>
            ) : value.length > 0 && isValid !== undefined ? (
              isValid ? (
                <CheckCircle size={18} className="text-green-600" />
              ) : (
                <XCircle size={18} className="text-red-500" />
              )
            ) : null}
          </div>
        )}

        {/* Case: only eye icon */}
        {!showStatus && showEye && (
          <div className="absolute inset-y-0 right-3 flex items-center">
            <button type="button" onClick={togglePasswordVisibility}>
              {isPasswordVisible ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
