/** URL-safe slug, trimmed to `max` characters without a trailing dash. */
export function slugify(value: string, max = 48): string {
  const slug = value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/g, '');
  return slug || 'project';
}
