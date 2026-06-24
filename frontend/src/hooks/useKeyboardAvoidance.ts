import { useState, useEffect, useRef } from "react";

/**
 * Hook that tracks the iOS/Android software keyboard height using the visualViewport API.
 * Returns { keyboardHeight, isOpening } so consumers can animate elements above the keyboard.
 *
 * Usage:
 *   const { keyboardHeight, isOpening } = useKeyboardAvoidance();
 *   style={{ bottom: keyboardHeight > 0 ? `calc(${keyboardHeight}px + env(safe-area-inset-bottom, 10px) + 6px)` : "0px" }}
 */
export function useKeyboardAvoidance() {
  const [state, setState] = useState({ keyboardHeight: 0, isOpening: false });
  const prevHeight = useRef(0);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    const update = () => {
      const gap = window.innerHeight - (vv.height + vv.offsetTop);
      const h = gap > 0 ? gap : 0;
      const opening = h > prevHeight.current;
      prevHeight.current = h;
      setState({ keyboardHeight: h, isOpening: opening });
    };

    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, []);

  return state;
}

/**
 * Returns the inline style for a fixed-bottom bar that animates with the keyboard.
 * Use this for CTA buttons that should stay above the keyboard.
 *
 * Usage:
 *   <div style={fixedBottomStyle(keyboardHeight, isOpening)}>
 *     <Button>Continuar</Button>
 *   </div>
 */
export function fixedBottomStyle(keyboardHeight: number, isOpening: boolean): React.CSSProperties {
  return {
    position: "fixed",
    left: 0,
    right: 0,
    bottom: keyboardHeight > 0
      ? `calc(${keyboardHeight}px + env(safe-area-inset-bottom, 10px) + 6px)`
      : "0px",
    padding: "16px 20px",
    paddingBottom: keyboardHeight > 0 ? "16px" : "32px",
    backgroundColor: "#fff",
    zIndex: 50,
    transition: isOpening
      ? "bottom 320ms cubic-bezier(0.33, 1, 0.68, 1)"
      : "bottom 280ms cubic-bezier(0.42, 0, 0.58, 1)",
  };
}
