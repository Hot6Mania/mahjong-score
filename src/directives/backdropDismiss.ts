import type { Directive, DirectiveBinding } from 'vue';

interface BackdropElement extends HTMLElement {
  _backdropHandlers?: {
    onPointerDown: (e: MouseEvent | TouchEvent) => void;
    onClick: (e: MouseEvent) => void;
  };
}

/**
 * 팝업 백드롭 외부 클릭 전용 지시자
 * 마우스 누름(mousedown/touchstart)과 마우스 뗌(click/mouseup)이
 * 모두 백드롭 요소 자신(el)에서 일어난 경우에만 콜백을 실행합니다.
 * 팝업 내부에서 클릭을 시작하여 외부로 드래그 후 마우스를 떼는 경우에는 모달이 닫히지 않습니다.
 */
export const vBackdropDismiss: Directive<BackdropElement, (() => void) | undefined> = {
  mounted(el, binding: DirectiveBinding<(() => void) | undefined>) {
    let isPointerDownSelf = false;

    const onPointerDown = (e: MouseEvent | TouchEvent) => {
      // 누른 시작 위치가 정확히 백드롭 요소 자신인 경우에만 플래그 활성화
      isPointerDownSelf = (e.target === el);
    };

    const onClick = (e: MouseEvent) => {
      // 누른 위치와 뗀 위치 모두 백드롭 요소 자신일 때만 닫기 콜백 실행
      if (isPointerDownSelf && e.target === el) {
        if (typeof binding.value === 'function') {
          binding.value();
        }
      }
      isPointerDownSelf = false;
    };

    el.addEventListener('mousedown', onPointerDown);
    el.addEventListener('touchstart', onPointerDown, { passive: true });
    el.addEventListener('click', onClick);

    el._backdropHandlers = { onPointerDown, onClick };
  },
  unmounted(el) {
    if (el._backdropHandlers) {
      el.removeEventListener('mousedown', el._backdropHandlers.onPointerDown);
      el.removeEventListener('touchstart', el._backdropHandlers.onPointerDown);
      el.removeEventListener('click', el._backdropHandlers.onClick);
      delete el._backdropHandlers;
    }
  }
};
