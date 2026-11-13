export type Tone = 'done' | 'signed' | 'flow' | 'waiting' | 'stopped' | 'neutral';

export interface StatusMeta {
  label: string;
  tone: Tone;
}

// Ordem importa: o primeiro padrão que casar define o tom.
const TONE_RULES: Array<[RegExp, Tone]> = [
  [/cancel|recusad|fraude|falh|estornad/i, 'stopped'],
  [/saiu|em[ _]tr[âa]nsito|em[ _]rota|a[ _]caminho/i, 'flow'],
  [/devolu|reembols/i, 'waiting'],
  [/entreg|conclu|finaliz|complet/i, 'done'],
  [/enviad|expedic|transito|transport|coleta|despach/i, 'flow'],
  [/prepar|separac|process|embal|aguardando|pendente|analise|faturamento/i, 'waiting'],
  [/pag|aprov|autoriz|confirm/i, 'signed'],
];

const TONE_TO_BADGE: Record<Tone, string> = {
  done: 'border-transparent bg-invert text-invert-ink',
  signed: 'border-line-strong bg-fill text-ink',
  flow: 'border-line bg-fill text-ink/85',
  waiting: 'border-dashed border-line bg-transparent text-muted',
  stopped: 'border-dashed border-line-strong bg-transparent text-muted',
  neutral: 'border-line bg-transparent text-faint',
};

const TONE_TO_DOT: Record<Tone, string> = {
  done: 'bg-current',
  signed: 'bg-current',
  flow: 'bg-current',
  waiting: 'border border-current bg-transparent',
  stopped: 'border border-current bg-transparent',
  neutral: 'bg-current',
};

const TONE_TO_BAR: Record<Tone, string> = {
  done: 'bg-ink',
  signed: 'bg-ink/70',
  flow: 'bg-ink/50',
  waiting: 'bg-ink/30',
  stopped: 'bar-striped bg-fill-strong text-ink/45',
  neutral: 'bg-ink/15',
};

export function statusMeta(rawStatus: string): StatusMeta {
  const normalized = rawStatus.trim();
  const tone = TONE_RULES.find(([rule]) => rule.test(normalized))?.[1] ?? 'neutral';

  const label = normalized
    .replace(/[_-]+/g, ' ')
    .toLowerCase()
    .replace(/(^|\s)\S/g, (char) => char.toUpperCase());

  return { label: label || 'Sem status', tone };
}

export function badgeClasses(tone: Tone): string {
  return TONE_TO_BADGE[tone];
}

export function dotClasses(tone: Tone): string {
  return TONE_TO_DOT[tone];
}

export function barClasses(tone: Tone): string {
  return TONE_TO_BAR[tone];
}
