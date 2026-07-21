export function formatWorkOrderNumber(year: number, sequence: number): string {
  if (!Number.isInteger(year) || year < 2000 || year > 9999) throw new Error('Invalid work-order year.');
  if (!Number.isInteger(sequence) || sequence < 1) throw new Error('Invalid work-order sequence.');
  return `FAC-${year}-${String(sequence).padStart(4, '0')}`;
}
