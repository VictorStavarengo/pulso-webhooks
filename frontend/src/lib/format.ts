const brlFormatter = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
});

const dateTimeFormatter = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short',
  timeStyle: 'short',
});

const relativeFormatter = new Intl.RelativeTimeFormat('pt-BR', { numeric: 'auto' });

const shortDateFormatter = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short' });

export function formatCurrency(value: number): string {
  return brlFormatter.format(Number.isFinite(value) ? value : 0);
}

export function parseServerDate(raw: string): Date {
  if (!raw) {
    return new Date(Number.NaN);
  }

  const hasTimezone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw);
  return new Date(hasTimezone ? raw : `${raw.replace(' ', 'T')}Z`);
}

export function formatDateTime(date: Date): string {
  return Number.isNaN(date.getTime()) ? '—' : dateTimeFormatter.format(date);
}

export function formatRelativeTime(date: Date, now = Date.now()): string {
  if (Number.isNaN(date.getTime())) {
    return '—';
  }

  const diffSeconds = Math.round((date.getTime() - now) / 1000);
  const abs = Math.abs(diffSeconds);

  if (abs < 45) {
    return 'agora mesmo';
  }

  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ['minute', 60],
    ['hour', 3600],
    ['day', 86400],
    ['week', 604800],
    ['month', 2592000],
    ['year', 31536000],
  ];

  let chosen = units[0];
  for (const unit of units) {
    if (abs >= unit[1]) {
      chosen = unit;
    }
  }

  return relativeFormatter.format(Math.round(diffSeconds / chosen[1]), chosen[0]);
}

export function formatCompactNumber(value: number): string {
  return new Intl.NumberFormat('pt-BR').format(value);
}

export function formatShortDate(date: Date): string {
  return Number.isNaN(date.getTime()) ? '—' : shortDateFormatter.format(date);
}
