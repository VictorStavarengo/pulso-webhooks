import type { ReactNode } from 'react';

interface StatCardProps {
  label: string;
  value: string;
  hint: string;
  icon: ReactNode;
  featured?: boolean;
  delay?: number;
}

export default function StatCard({
  label,
  value,
  hint,
  icon,
  featured = false,
  delay = 0,
}: StatCardProps) {
  return (
    <div
      className={`animate-rise group relative overflow-hidden rounded-xl border p-5 ${
        featured
          ? 'border-transparent bg-invert text-invert-ink'
          : 'border-line bg-surface transition duration-300 hover:border-line-strong'
      }`}
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="flex items-start justify-between gap-3">
        <p
          className={`text-[10px] font-medium uppercase tracking-[0.18em] ${
            featured ? 'text-invert-ink/60' : 'text-faint'
          }`}
        >
          {label}
        </p>
        <span
          className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg border ${
            featured ? 'border-invert-ink/20 text-invert-ink' : 'border-line text-muted'
          }`}
        >
          {icon}
        </span>
      </div>

      <p
        className={`mt-5 font-mono text-[27px] font-semibold leading-none tracking-[-0.03em] tabular-nums ${
          featured ? 'text-invert-ink' : 'text-ink'
        }`}
      >
        {value}
      </p>
      <p className={`mt-2.5 text-[11.5px] ${featured ? 'text-invert-ink/60' : 'text-muted'}`}>
        {hint}
      </p>
    </div>
  );
}
