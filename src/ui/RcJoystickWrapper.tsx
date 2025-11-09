import React, { useCallback, useRef } from 'react';

interface RcJoystickWrapperProps { onMove: (x: number, y: number) => void; }

/**
 * Multi-touch robust joystick with the same visual styling.
 * Uses our own pointer handling while keeping the base/knob visuals.
 */
const RcJoystickWrapper: React.FC<RcJoystickWrapperProps> = ({ onMove }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const knobRef = useRef<HTMLDivElement>(null);
  const activePointerId = useRef<number | null>(null);
  const centerRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const radiusRef = useRef<number>(60);
  const lastOutRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  const setKnob = (dx: number, dy: number) => {
    if (!knobRef.current) return;
    // Preserve center translate then apply offset so knob remains visually centered
    knobRef.current.style.transform = `translate(-50%, -50%) translate(${dx}px, ${dy}px)`;
  };

  const emitMove = (x: number, y: number) => {
    const mag = Math.hypot(x, y);
    let outX = x, outY = y;
    if (mag > 0) {
      const ang = Math.atan2(y, x);
      const responsiveMag = Math.min(1, Math.pow(Math.min(1, mag), 0.85) * 1.15);
      outX = responsiveMag * Math.cos(ang);
      outY = responsiveMag * Math.sin(ang);
    }
    if (Math.abs(outX - lastOutRef.current.x) > 0.01 || Math.abs(outY - lastOutRef.current.y) > 0.01) {
      lastOutRef.current = { x: outX, y: outY };
      onMove(outX, outY);
    }
  };

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (activePointerId.current !== null) return;
    activePointerId.current = e.pointerId;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const rect = containerRef.current!.getBoundingClientRect();
    centerRef.current = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    const knobHalf = Math.max(20, Math.floor((knobRef.current?.offsetWidth || 50) / 2));
    radiusRef.current = Math.min(rect.width, rect.height) / 2 - knobHalf; // dynamic based on knob size
    const dx = e.clientX - centerRef.current.x;
    const dy = e.clientY - centerRef.current.y;
    const dist = Math.hypot(dx, dy);
    const maxR = radiusRef.current;
    const clampedDx = dist > maxR ? (dx / dist) * maxR : dx;
    const clampedDy = dist > maxR ? (dy / dist) * maxR : dy;
    setKnob(clampedDx, clampedDy);
    const nx = clampedDx / maxR;
    const ny = clampedDy / maxR;
    const m = Math.hypot(nx, ny);
    emitMove(m < 0.05 ? 0 : nx, m < 0.05 ? 0 : -ny);
  }, []);

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (activePointerId.current !== e.pointerId) return;
    const dx = e.clientX - centerRef.current.x;
    const dy = e.clientY - centerRef.current.y;
    const dist = Math.hypot(dx, dy);
    const maxR = radiusRef.current;
    const clampedDx = dist > maxR ? (dx / dist) * maxR : dx;
    const clampedDy = dist > maxR ? (dy / dist) * maxR : dy;
    setKnob(clampedDx, clampedDy);
    const nx = clampedDx / maxR;
    const ny = clampedDy / maxR;
    const m = Math.hypot(nx, ny);
    emitMove(m < 0.05 ? 0 : nx, m < 0.05 ? 0 : -ny);
  }, []);

  const handlePointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (activePointerId.current !== e.pointerId) return;
    activePointerId.current = null;
    setKnob(0, 0);
    onMove(0, 0);
  }, [onMove]);

  return (
    <button
      type="button"
      ref={containerRef as any}
      className="joystick-container"
      aria-label="Virtual joystick"
      style={{ touchAction: 'none', background: 'transparent', border: 0, padding: 0 }}
      onPointerDown={handlePointerDown as any}
      onPointerMove={handlePointerMove as any}
      onPointerUp={handlePointerUp as any}
      onPointerCancel={handlePointerUp as any}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="joystick-base">
        <div ref={knobRef} className="joystick-knob" />
      </div>
    </button>
  );
};

export default RcJoystickWrapper;
