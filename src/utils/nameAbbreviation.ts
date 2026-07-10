/**
 * 4명의 이름 목록을 받아 앞 글자 최소 2글자에서 시작하여,
 * 서로 겹치지 않을 때까지 글자 수를 연장해 고유한 축약 명칭 배열을 반환합니다.
 */
export const getShortNames = (names: string[]): string[] => {
  return names.map(name => name ? name.substring(0, 2) : '');
};
