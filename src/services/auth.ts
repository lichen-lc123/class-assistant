export interface User {
  id: number; studentId: string; name: string; role: 'student' | 'admin';
  mustChangePassword: boolean; createdAt: string; updatedAt: string;
}
export interface LoginCredentials { studentId: string; password: string }
export type LoginResult = User;
export type LoginHandler = (credentials: LoginCredentials) => Promise<User>;
export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export async function api<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, { method, credentials: 'same-origin',
      headers: method !== 'GET' ? { 'Content-Type': 'application/json' } : {},
      body: body === undefined ? undefined : JSON.stringify(body) });
  } catch { throw new ApiError(0, '网络连接失败，请稍后重试。'); }
  let data: T & { message?: string };
  try { data = await response.json(); } catch { throw new ApiError(502, '服务暂时不可用，请稍后重试。'); }
  if (!response.ok) {
    if (response.status === 401 && path !== '/auth/login') window.dispatchEvent(new Event('session-expired'));
    throw new ApiError(response.status, data.message || '操作失败，请稍后重试。');
  }
  return data;
}
export const login: LoginHandler = (credentials) => api('/auth/login', 'POST', credentials);
