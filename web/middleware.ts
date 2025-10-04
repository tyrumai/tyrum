import { NextRequest, NextResponse } from "next/server";
import {
  CTA_FROM_PARAM,
  CTA_REDIRECT_PARAM,
  CTA_REDIRECT_REASON,
  PORTAL_SESSION_COOKIE,
  isProtectedPortalPath,
} from "./app/lib/portal-auth";

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (!isProtectedPortalPath(pathname)) {
    return NextResponse.next();
  }

  const sessionCookie = request.cookies.get(PORTAL_SESSION_COOKIE)?.value?.trim();

  if (sessionCookie) {
    return NextResponse.next();
  }

  const redirectUrl = new URL("/", request.url);
  redirectUrl.searchParams.set(CTA_REDIRECT_PARAM, CTA_REDIRECT_REASON);
  redirectUrl.searchParams.set(CTA_FROM_PARAM, pathname);

  return NextResponse.redirect(redirectUrl);
}

export const config = {
  matcher: ["/portal/:path*"],
};
