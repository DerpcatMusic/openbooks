// Toasts: call toast("Saved") anywhere; <Toaster /> (once, in the root layout) shows them.
// action: a button (e.g. Undo); with `value`, an editable input whose text is passed to run() (e.g. "Create rule: <match>").
export interface ToastAction {
  label: string;
  value?: string;
  run: (value: string) => void;
}
export interface ToastItem {
  id: number;
  msg: string;
  tone: "neutral" | "bad";
  action?: ToastAction;
  ms: number;
}

export const toasts: ToastItem[] = $state([]);
let next = 1;

export function toast(msg: string, opts: { action?: ToastAction; tone?: "neutral" | "bad"; ms?: number } = {}): number {
  const id = next++;
  toasts.push({ id, msg, tone: opts.tone ?? "neutral", action: opts.action, ms: opts.ms ?? (opts.action ? 12000 : 4000) });
  if (toasts.length > 3) toasts.shift();
  return id;
}

export function dismiss(id: number) {
  const i = toasts.findIndex((t) => t.id === id);
  if (i >= 0) toasts.splice(i, 1);
}
