export function apiUrl(path: string) {
  const base = (import.meta.env.VITE_API_BASE as string | undefined) ?? ''
  if (!base) return path
  return `${base.replace(/\/$/, '')}${path.startsWith('/') ? '' : '/'}${path}`
}

export async function apiFetch(path: string, init?: RequestInit) {
  const url = apiUrl(path)
  const r = await fetch(url, init)
  return r
}

