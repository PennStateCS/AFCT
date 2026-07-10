'use client';

import { useCallback, useRef, useState } from 'react';
import { Label } from '@/components/ui/label';
import { X, Upload } from 'lucide-react';

export type FileUploadInputProps = {
  id: string;
  label: string;
  name: string;
  accept?: string;
  maxSizeMb: number;
  disabled?: boolean;
  onChange: (file: File | undefined) => void;
  value?: File;
  error?: string;
  description?: string;
  hint?: string;
};

export default function FileUploadInput({
  id,
  label,
  name,
  accept = '*',
  maxSizeMb,
  disabled = false,
  onChange,
  value,
  error,
  description,
  hint,
}: FileUploadInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [fileError, setFileError] = useState<string>('');

  const maxBytes = maxSizeMb * 1024 * 1024;

  const validateFile = useCallback(
    (file: File): boolean => {
      if (file.size > maxBytes) {
        const sizeMb = (file.size / 1024 / 1024).toFixed(2);
        setFileError(`File is ${sizeMb}MB, exceeds limit of ${maxSizeMb}MB`);
        return false;
      }
      setFileError('');
      return true;
    },
    [maxBytes, maxSizeMb],
  );

  const handleFileSelect = useCallback(
    (file: File | null) => {
      if (!file) {
        onChange(undefined);
        setFileError('');
        return;
      }

      if (validateFile(file)) {
        onChange(file);
      } else {
        onChange(undefined);
      }
    },
    [onChange, validateFile],
  );

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    handleFileSelect(file ?? null);
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    if (disabled) return;
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    if (disabled) return;
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const file = e.dataTransfer.files?.[0];
    if (file) {
      handleFileSelect(file);
    }
  };

  const handleClear = () => {
    onChange(undefined);
    setFileError('');
    if (inputRef.current) {
      inputRef.current.value = '';
    }
  };

  const formattedSize = value ? `${(value.size / 1024 / 1024).toFixed(2)}MB` : `Max ${maxSizeMb}MB`;

  const hasError = !!error || !!fileError;

  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>

      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`relative rounded-lg border-2 border-dashed transition-colors ${
          disabled
            ? 'bg-muted/5 border-border cursor-not-allowed'
            : isDragging
              ? 'border-primary bg-primary/5'
              : value
                ? 'border-green-300 bg-green-50'
                : hasError
                  ? 'border-destructive bg-destructive/5'
                  : 'border-border bg-muted/15 hover:border-primary/50'
        }`}
      >
        <input
          ref={inputRef}
          id={id}
          name={name}
          type="file"
          accept={accept}
          disabled={disabled}
          onChange={handleInputChange}
          className="absolute inset-0 cursor-pointer opacity-0"
          aria-label={label}
          aria-describedby={hasError ? `${id}-error` : `${id}-help`}
        />

        <div className="flex flex-col items-center justify-center gap-3 p-6 text-center">
          {value ? (
            <>
              <div className="flex items-center gap-2">
                <div className="text-left">
                  <p className="text-foreground text-sm font-medium">
                    <span className="inline-flex items-center gap-2">
                      <Upload className="h-3 w-3 text-green-600" />
                      <span className="truncate">{value.name}</span>
                    </span>
                  </p>
                  <p className="text-muted-foreground text-xs">{formattedSize}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={handleClear}
                disabled={disabled}
                className="text-primary text-xs hover:underline disabled:opacity-50"
              >
                Clear selection
              </button>
            </>
          ) : (
            <>
              <div>
                <p className="text-sm font-medium">
                  <span className="inline-flex items-center gap-2">
                    <Upload className={`h-3 w-3 ${isDragging ? 'text-primary' : 'text-muted-foreground'}`} />
                    <span>Drop file here or click to select</span>
                  </span>
                </p>
                <p className="text-muted-foreground text-xs">{formattedSize}</p>
              </div>
            </>
          )}
        </div>
      </div>

      {description && <p className="text-muted-foreground text-xs">{description}</p>}

      {hint && !hasError && (
        <p id={`${id}-help`} className="text-muted-foreground text-xs">
          {hint}
        </p>
      )}

      {hasError && (
        <p id={`${id}-error`} className="text-destructive flex items-center gap-1 text-xs">
          <X className="h-3 w-3" />
          {fileError || error}
        </p>
      )}
    </div>
  );
}
