/** Escapes LIKE wildcards (MariaDB default escape char is backslash). */
export function escapeLike(value: string): string {
  return value.replaceAll(/[\\%_]/g, match => `\\${match}`);
}

export function containsPattern(value: string): string {
  return `%${escapeLike(value)}%`;
}

export function prefixPattern(value: string): string {
  return `${escapeLike(value)}%`;
}
