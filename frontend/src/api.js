const BASE = import.meta.env.VITE_API_BASE || '/api'

export async function chat(messages, profile) {
  const r = await fetch(`${BASE}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages, profile }),
  })
  if (!r.ok) throw new Error(`API ${r.status}`)
  return r.json()
}

export async function listTrails() {
  const r = await fetch(`${BASE}/trails`)
  if (!r.ok) throw new Error(`API ${r.status}`)
  return r.json()
}
