const INT4_MAX = 2_147_483_647;

/**
 * Strict parser for an id that will reach Postgres: a positive integer, or a
 * string of plain digits. Anything else is refused (null). Number() and the
 * Postgres integer input disagree on some strings — PostgreSQL 16 reads
 * '1_000' as 1000 while Number('1_000') is NaN — so a permission check that
 * normalises with Number() and a query that receives the raw value can look
 * at two different rows. Normalise once with this, then use the result for
 * both.
 */
export function toDbId(value: unknown): number | null {
  let n: number;
  if (typeof value === 'number') n = value;
  else if (typeof value === 'string' && /^\d{1,10}$/.test(value)) n = Number(value);
  else return null;
  return Number.isInteger(n) && n > 0 && n <= INT4_MAX ? n : null;
}

/** Every entry valid → the normalised ids; any invalid entry → null. */
export function toDbIds(values: readonly unknown[]): number[] | null {
  const out: number[] = [];
  for (const v of values) {
    const id = toDbId(v);
    if (id == null) return null;
    out.push(id);
  }
  return out;
}

/** The valid ids only (stored data read back: drop what cannot be an id). */
export function validDbIds(values: readonly unknown[]): number[] {
  const out: number[] = [];
  for (const v of values) {
    const id = toDbId(v);
    if (id != null) out.push(id);
  }
  return out;
}
