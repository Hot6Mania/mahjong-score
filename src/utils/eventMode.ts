/**
 * 2026 KNU X NPM MAHJONG TEAM LEAGUE 이벤트 모드 및 테스트 샌드박스 감지 유틸리티
 */

export const KNU_NPM_EVENT_ID = 'knu-npm-2026' as const;
export const KNU_NPM_EVENT_TITLE = '2026 KNU X NPM MAHJONG TEAM LEAGUE';
export const KNU_NPM_EVENT_PATH_PREFIX = '/knu-npm-2026';

export function isKnuNpmEventHost(): boolean {
  if (import.meta.env.VITE_EVENT_MODE === KNU_NPM_EVENT_ID) {
    return true;
  }
  if (typeof window === 'undefined') return false;
  const host = (window.location.hostname || '').toLowerCase();
  return (
    host === 'knu-npm.kimk-house.party' ||
    host.startsWith('knu-npm.') ||
    host.startsWith('knu-npm-')
  );
}

export function isKnuNpmEventPath(path?: string): boolean {
  const targetPath =
    path !== undefined
      ? path
      : typeof window !== 'undefined'
        ? window.location.pathname
        : '';
  return (
    targetPath === KNU_NPM_EVENT_PATH_PREFIX ||
    targetPath.startsWith(`${KNU_NPM_EVENT_PATH_PREFIX}/`)
  );
}

export function isKnuNpmEventMode(path?: string): boolean {
  if (isKnuNpmEventHost()) return true;
  if (isKnuNpmEventPath(path)) return true;
  if (typeof window !== 'undefined') {
    const params = new URLSearchParams(window.location.search || '');
    if (params.get('event') === KNU_NPM_EVENT_ID) return true;
  }
  return false;
}

export function isKnuNpmSandboxMode(path?: string): boolean {
  const targetPath =
    path !== undefined
      ? path
      : typeof window !== 'undefined'
        ? window.location.pathname
        : '';
  if (
    targetPath === '/test' ||
    targetPath.startsWith('/test/') ||
    targetPath === `${KNU_NPM_EVENT_PATH_PREFIX}/test` ||
    targetPath.startsWith(`${KNU_NPM_EVENT_PATH_PREFIX}/test/`)
  ) {
    return true;
  }
  if (typeof window !== 'undefined') {
    const params = new URLSearchParams(window.location.search || '');
    if (params.get('sandbox') === '1' || params.get('test') === '1') {
      return true;
    }
  }
  return false;
}

export function isKnuNpmLiveMonitorPath(path?: string): boolean {
  const targetPath =
    path !== undefined
      ? path
      : typeof window !== 'undefined'
        ? window.location.pathname
        : '';
  return (
    targetPath === '/live' ||
    targetPath === '/test/live' ||
    targetPath === `${KNU_NPM_EVENT_PATH_PREFIX}/live` ||
    targetPath === `${KNU_NPM_EVENT_PATH_PREFIX}/test/live`
  );
}

export function getKnuNpmBasePath(sandbox = false): string {
  if (isKnuNpmEventHost()) {
    return sandbox ? '/test' : '';
  }
  return sandbox ? `${KNU_NPM_EVENT_PATH_PREFIX}/test` : KNU_NPM_EVENT_PATH_PREFIX;
}

export function getKnuNpmLiveMonitorPath(sandbox = false): string {
  const base = getKnuNpmBasePath(sandbox);
  return `${base}/live`;
}
