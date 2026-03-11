/* ── File type badges (colored 2-char) — shared by FileTree + FileAutocomplete ── */

export const EXT_ICON: Record<string, { color: string; label: string }> = {
  ts:    { color: '#3178C6', label: 'TS' },
  tsx:   { color: '#3178C6', label: 'TX' },
  js:    { color: '#F7DF1E', label: 'JS' },
  jsx:   { color: '#F7DF1E', label: 'JX' },
  json:  { color: '#A8A8A8', label: '{}' },
  css:   { color: '#563D7C', label: 'CS' },
  scss:  { color: '#CD6799', label: 'SC' },
  html:  { color: '#E34C26', label: '<>' },
  md:    { color: '#519ABA', label: 'MD' },
  yml:   { color: '#CB171E', label: 'YL' },
  yaml:  { color: '#CB171E', label: 'YL' },
  toml:  { color: '#9C4221', label: 'TM' },
  py:    { color: '#3776AB', label: 'PY' },
  rs:    { color: '#DEA584', label: 'RS' },
  sh:    { color: '#89E051', label: 'SH' },
  svg:   { color: '#FFB13B', label: 'SV' },
  png:   { color: '#A074C4', label: 'PN' },
  jpg:   { color: '#A074C4', label: 'JP' },
  lock:  { color: '#6B6B6B', label: 'LK' },
  gitignore: { color: '#F05032', label: 'GI' },
}

export function getFileIcon(name: string) {
  const stripped = name.startsWith('.') ? name.slice(1).toLowerCase() : ''
  if (stripped && EXT_ICON[stripped]) return EXT_ICON[stripped]
  const ext = name.split('.').pop()?.toLowerCase() || ''
  return EXT_ICON[ext] || null
}
