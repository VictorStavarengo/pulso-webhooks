import { badgeClasses, dotClasses, statusMeta } from '../lib/status';

interface StatusBadgeProps {
  status: string;
  className?: string;
}

export default function StatusBadge({ status, className = '' }: StatusBadgeProps) {
  const meta = statusMeta(status);

  return (
    <span
      title={status}
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-[11px] font-medium leading-none ${badgeClasses(meta.tone)} ${className}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${dotClasses(meta.tone)}`} />
      {meta.label}
    </span>
  );
}
