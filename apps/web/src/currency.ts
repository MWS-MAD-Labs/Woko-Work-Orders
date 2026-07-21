export function parseIdrInput(value: string): number {
  const digits = value.replaceAll(/\D/g, '');
  return digits ? Number(digits) : 0;
}

export function formatIdrInput(value: string | number): string {
  const amount = typeof value === 'number' ? value : parseIdrInput(value);
  return amount > 0 ? new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 }).format(amount) : '';
}

export function formatIdrCurrency(value: number): string {
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(value);
}
