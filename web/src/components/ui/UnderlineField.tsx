import { cn } from "@/lib/cn";

export function UnderlineField({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
  hint?: string;
}) {
  return (
    <label className="block">
      <span className="text-[11px] font-medium tracking-[0.08em] text-muted uppercase">{label}</span>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className={cn(
          "mt-1 w-full border-0 border-b border-line bg-transparent py-2 text-[15px] text-ink placeholder:text-muted",
        )}
      />
      {hint ? <p className="mt-1 text-xs italic text-muted">{hint}</p> : null}
    </label>
  );
}

export function PrimaryButton({
  children,
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={cn(
        "w-full rounded-xl bg-inverse py-3.5 text-[15px] font-medium text-on-inverse disabled:opacity-50",
        className,
      )}
    >
      {children}
    </button>
  );
}
