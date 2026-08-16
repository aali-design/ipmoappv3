import { forwardRef, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react'

interface FieldProps {
  label?: ReactNode
  htmlFor?: string
  hint?: ReactNode
  error?: ReactNode
  required?: boolean
  children: ReactNode
}

export function Field({ label, htmlFor, hint, error, required, children }: FieldProps) {
  return (
    <div className="field">
      {label ? (
        <label className="field-label" htmlFor={htmlFor}>
          {label}
          {required ? <span aria-hidden="true"> *</span> : null}
        </label>
      ) : null}
      {children}
      {hint ? <span className="field-hint">{hint}</span> : null}
      {error ? (
        <span className="field-error" role="alert">
          {error}
        </span>
      ) : null}
    </div>
  )
}

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { invalid, className, ...rest },
  ref,
) {
  return <input ref={ref} className={`input ${className ?? ''}`} aria-invalid={invalid || undefined} {...rest} />
})

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  invalid?: boolean
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { invalid, className, children, ...rest },
  ref,
) {
  return (
    <select ref={ref} className={`select ${className ?? ''}`} aria-invalid={invalid || undefined} {...rest}>
      {children}
    </select>
  )
})

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { invalid, className, ...rest },
  ref,
) {
  return <textarea ref={ref} className={`textarea ${className ?? ''}`} aria-invalid={invalid || undefined} {...rest} />
})

interface CheckboxProps extends InputHTMLAttributes<HTMLInputElement> {
  label: ReactNode
}

export function Checkbox({ label, id, className, ...rest }: CheckboxProps) {
  return (
    <label className={`checkbox-row ${className ?? ''}`} htmlFor={id}>
      <input type="checkbox" id={id} {...rest} />
      <span>{label}</span>
    </label>
  )
}
