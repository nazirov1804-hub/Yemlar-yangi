export const money = (value) => `${new Intl.NumberFormat('uz-UZ', { maximumFractionDigits: 0 }).format(Number(value) || 0)} so‘m`

export const numberInput = (value) => {
  const amount = Number(value)
  return Number.isFinite(amount) ? new Intl.NumberFormat('uz-UZ', { maximumFractionDigits: 0 }).format(amount) : ''
}

export const readNumber = (value) => {
  const digits = String(value ?? '').replace(/\D/g, '')
  return digits ? Number(digits) : 0
}

export async function api(path, options = {}) {
  let response
  try {
    response = await fetch(path, {
      method: options.method || 'GET',
      credentials: 'same-origin',
      headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
      body: options.body ? JSON.stringify(options.body) : undefined,
    })
  } catch {
    throw new Error('Serverga ulanib bo‘lmadi. `npm run dev:all` bilan ilovani qayta ishga tushiring.')
  }
  if (response.status === 204) return null
  const result = await response.json().catch(() => null)
  if (!response.ok) {
    const error = new Error(result?.error || `So‘rov bajarilmadi (HTTP ${response.status}).`)
    error.status = response.status
    error.details = result
    throw error
  }
  return result
}
