const KEY = 'defi-ctf-progress';

export function markSolved(challengeId: string): void {
  const p = getProgress();
  p[challengeId] = true;
  localStorage.setItem(KEY, JSON.stringify(p));
}

export function getProgress(): Record<string, boolean> {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '{}'); }
  catch { return {}; }
}

export function resetProgress(): void {
  localStorage.removeItem(KEY);
}

export function isSolved(challengeId: string): boolean {
  return !!getProgress()[challengeId];
}

export function solvedCount(): number {
  return Object.values(getProgress()).filter(Boolean).length;
}
