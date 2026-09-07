import { NextResponse, type NextRequest } from 'next/server'
import { createServerSupabase } from '@/lib/supabase/server'

/**
 * Ends the session of an account that has been closed.
 *
 * Redirecting a closed account to `/login` on its own does not work, and the
 * way it fails is instructive: the proxy sends signed-in people away from the
 * sign-in page, the layout sends people with no role to it, and a closed
 * account is both at once. The two rules push against each other and the
 * browser gives up after twenty hops.
 *
 * Ending the session is the answer rather than a way round the loop. Somebody
 * whose account was closed a minute ago should not still be holding a live
 * session; the loop was the system noticing that and having nowhere to put it.
 *
 * A route handler, because only a route handler or a server action may clear
 * the cookie — a server component cannot. `/auth` is already public to the
 * proxy, so this is reachable while holding a session it is about to destroy.
 */
export async function GET(request: NextRequest) {
  const supabase = await createServerSupabase()
  await supabase.auth.signOut()

  const url = request.nextUrl.clone()
  url.pathname = '/login'
  // Says why, so somebody who was working a moment ago is not left wondering
  // whether they mistyped their own password.
  url.search = '?closed=1'
  return NextResponse.redirect(url)
}
