import { NextResponse, type NextRequest } from 'next/server'
import { updateSession } from '@/lib/supabase/session'

const PUBLIC_PATHS = ['/login', '/auth']

export async function proxy(request: NextRequest) {
  const { response, signedIn } = await updateSession(request)
  const { pathname } = request.nextUrl

  if (!signedIn && !PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }
  if (signedIn && pathname === '/login') {
    const url = request.nextUrl.clone()
    url.pathname = '/'
    return NextResponse.redirect(url)
  }
  return response
}

// The antd stylesheet (public/antd/) is linked from every page, the sign-in
// page included. Checked here, it was redirected to /login before anybody had
// signed in, and the redirect was cached as long as the stylesheet itself.
export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|antd/|.*\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
}
