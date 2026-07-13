import React, { createContext, useContext } from 'react';

type WrapperProps = { children?: React.ReactNode };

const Wrapper = ({ children }: WrapperProps) => <div>{children}</div>;

type DialogContextValue = {
  onOpenChange?: (open: boolean) => void;
};

const DialogContext = createContext<DialogContextValue>({});

const Dialog = ({
  children,
  onOpenChange,
}: WrapperProps & { onOpenChange?: (open: boolean) => void }) => (
  <DialogContext.Provider value={{ onOpenChange }}>
    <div data-testid="dialog-root" data-open>
      {children}
    </div>
  </DialogContext.Provider>
);

const DialogClose = ({
  children,
}: {
  children: React.ReactElement<{
    onClick?: (event: React.MouseEvent<HTMLButtonElement>) => void;
  }>;
}) => {
  const ctx = useContext(DialogContext);
  return React.cloneElement(children, {
    onClick: (event: React.MouseEvent<HTMLButtonElement>) => {
      children.props?.onClick?.(event);
      ctx.onOpenChange?.(false);
    },
  });
};

export const dialogMock = {
  __esModule: true,
  Dialog,
  DialogContent: Wrapper,
  DialogHeader: Wrapper,
  DialogTitle: Wrapper,
  DialogDescription: Wrapper,
  DialogFooter: Wrapper,
  DialogClose,
};

type InputGroupFieldProps = {
  value?: string | number;
  onChange?: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onBlur?: (event: React.FocusEvent<HTMLInputElement>) => void;
  disabled?: boolean;
  min?: number | string;
  max?: number | string;
  step?: number | string;
  placeholder?: string;
};

type InputGroupProps = {
  label: string;
  name: string;
  type?: string;
  value?: string | number;
  setValue?: (value: string) => void;
  fieldProps?: InputGroupFieldProps;
  disabled?: boolean;
  min?: number | string;
  max?: number | string;
  step?: number | string;
  placeholder?: string;
  description?: string;
  error?: string;
};

const InputGroupMock = ({
  label,
  name,
  type = 'text',
  value,
  setValue,
  fieldProps,
  disabled,
  min,
  max,
  step,
  placeholder,
  description,
  error,
}: InputGroupProps) => {
  const restFieldProps = fieldProps ?? {};
  const resolvedValue = value ?? (restFieldProps?.value !== undefined ? restFieldProps.value : '');

  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setValue?.(event.target.value);
    restFieldProps?.onChange?.(event);
  };

  const handleBlur = (event: React.FocusEvent<HTMLInputElement>) => {
    restFieldProps?.onBlur?.(event);
  };

  return (
    <label style={{ display: 'block' }}>
      <span>{label}</span>
      <input
        aria-label={label}
        name={name}
        type={type}
        value={String(resolvedValue)}
        onChange={handleChange}
        onBlur={handleBlur}
        disabled={disabled ?? restFieldProps?.disabled}
        min={(min ?? restFieldProps?.min) as number | undefined}
        max={(max ?? restFieldProps?.max) as number | undefined}
        step={(step ?? restFieldProps?.step) as number | undefined}
        placeholder={(placeholder ?? restFieldProps?.placeholder) as string | undefined}
      />
      {description ? <small>{description}</small> : null}
      {error ? (
        <span role="alert" style={{ color: 'red' }}>
          {error}
        </span>
      ) : null}
    </label>
  );
};

export const inputGroupMock = {
  __esModule: true,
  default: InputGroupMock,
};

type SelectContextValue = {
  currentValue?: string;
  onValueChange?: (value: string) => void;
};

const SelectContext = createContext<SelectContextValue>({});

const Select = ({
  value,
  defaultValue,
  onValueChange,
  children,
}: {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  children?: React.ReactNode;
}) => (
  <SelectContext.Provider value={{ currentValue: value ?? defaultValue, onValueChange }}>
    <div>{children}</div>
  </SelectContext.Provider>
);

const SelectTrigger = ({ children, ...props }: React.HTMLAttributes<HTMLButtonElement>) => (
  <button type="button" {...props}>
    {children}
  </button>
);

const SelectValue = ({ placeholder }: { placeholder?: string }) => {
  const ctx = useContext(SelectContext);
  return <span>{ctx.currentValue ?? placeholder ?? ''}</span>;
};

const SelectContent = ({ children }: WrapperProps) => <div>{children}</div>;

const SelectItem = ({ value, children }: { value: string; children: React.ReactNode }) => {
  const ctx = useContext(SelectContext);
  return (
    <button type="button" onClick={() => ctx.onValueChange?.(value)}>
      {children}
    </button>
  );
};

export const selectMock = {
  __esModule: true,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
};

const SwitchMock = ({
  id,
  checked,
  onCheckedChange,
  'aria-label': ariaLabel,
}: {
  id?: string;
  checked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  'aria-label'?: string;
}) => (
  <input
    type="checkbox"
    role="switch"
    id={id}
    aria-label={ariaLabel}
    checked={!!checked}
    onChange={(event) => onCheckedChange?.(event.target.checked)}
  />
);

export const switchMock = {
  __esModule: true,
  Switch: SwitchMock,
};
