export interface ApiResponse {
  status: number
  body: any
}

export async function request(
  baseUrl: string,
  method: string,
  path: string,
  opts: { token?: string; body?: unknown } = {},
): Promise<ApiResponse> {
  const headers: Record<string, string> = {}
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`
  let bodyText: string | undefined
  if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json'
    bodyText = JSON.stringify(opts.body)
  }
  const res = await fetch(`${baseUrl}${path}`, { method, headers, body: bodyText })
  const text = await res.text()
  let body: any = null
  if (text) {
    try {
      body = JSON.parse(text)
    } catch {
      body = text
    }
  }
  return { status: res.status, body }
}

export function login(baseUrl: string, email: string, password: string): Promise<ApiResponse> {
  return request(baseUrl, 'POST', '/api/auth/login', { body: { email, password } })
}
