import {MobileAccess} from './services/mobile-access';
/** Cookies are scoped by host, not by port. The preview must never overwrite the
 * production phone session when both HTTPS entrances share a LAN hostname. */
export class PreviewMobileAccess extends MobileAccess {
  override token(req: {headers: {cookie?: string}}): string {
    return /(?:^|;\s*)rcm_mobile_preview=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie || '')?.[1] || '';
  }
  override cookie(token = ''): string {
    return super.cookie(token).replace(/^rcm_mobile=/, 'rcm_mobile_preview=');
  }
}
