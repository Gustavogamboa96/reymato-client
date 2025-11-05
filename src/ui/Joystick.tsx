import { useRef, useEffect, useState, useCallback } from 'react';

interface JoystickProps {
  onMove: (x: number, y: number) => void;
}

const Joystick = ({ onMove }: JoystickProps) => {
  const containerRef = useRef<HTMLButtonElement>(null);
  const knobRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const handleStart = useCallback((_clientX: number, _clientY: number) => {
    if (!containerRef.current) return;
    
    setIsDragging(true);
  }, []);

  const handleMove = useCallback((clientX: number, clientY: number) => {
    if (!isDragging || !containerRef.current || !knobRef.current) return;
    
    const rect = containerRef.current.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const maxRadius = rect.width / 2 - 25; // Account for knob size
    
    const deltaX = clientX - centerX;
    const deltaY = clientY - centerY;
    const distance = Math.hypot(deltaX, deltaY);
    
    let finalX = deltaX;
    let finalY = deltaY;
    
    if (distance > maxRadius) {
      finalX = (deltaX / distance) * maxRadius;
      finalY = (deltaY / distance) * maxRadius;
    }
    
    // Update knob position
    knobRef.current.style.transform = `translate(${finalX}px, ${finalY}px)`;
    
    // Normalize values to -1 to 1 with a slight non-linear boost for responsiveness
    const nx = finalX / maxRadius;
    const ny = -finalY / maxRadius; // Invert Y for game coordinates
    const mag = Math.min(1, Math.hypot(nx, ny));
    const angle = Math.atan2(ny, nx);
    // Non-linear response: exponent < 1 boosts near-center responsiveness; slight amplification
    const responsiveMag = Math.min(1, Math.pow(mag, 0.85) * 1.15);
    const outX = responsiveMag * Math.cos(angle);
    const outY = responsiveMag * Math.sin(angle);

    onMove(outX, outY);
  }, [isDragging, onMove]);

  const handleEnd = useCallback(() => {
    if (!knobRef.current) return;
    
    setIsDragging(false);
    
    // Return knob to center
    knobRef.current.style.transform = 'translate(0px, 0px)';
    onMove(0, 0);
  }, [onMove]);

  // Mouse events
  const handleMouseDown = (e: React.MouseEvent) => {
    handleStart(e.clientX, e.clientY);
  };

  const handleMouseMove = useCallback((e: MouseEvent) => {
    handleMove(e.clientX, e.clientY);
  }, [handleMove]);

  const handleMouseUp = useCallback(() => {
    handleEnd();
  }, [handleEnd]);

  // Touch events
  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 1) {
      const touch = e.touches[0];
      handleStart(touch.clientX, touch.clientY);
    }
  };

  const handleTouchMove = useCallback((e: TouchEvent) => {
    if (e.touches.length === 1) {
      const touch = e.touches[0];
      handleMove(touch.clientX, touch.clientY);
    }
    e.preventDefault(); // Prevent scrolling
  }, [handleMove]);

  const handleTouchEnd = useCallback(() => {
    handleEnd();
  }, [handleEnd]);

  useEffect(() => {
    if (isDragging) {
      // Add global event listeners
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.addEventListener('touchmove', handleTouchMove, { passive: false });
      document.addEventListener('touchend', handleTouchEnd);
      
      return () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
        document.removeEventListener('touchmove', handleTouchMove);
        document.removeEventListener('touchend', handleTouchEnd);
      };
    }
  }, [isDragging, handleMouseMove, handleMouseUp, handleTouchMove, handleTouchEnd]);

  return (
    <button type="button"
      ref={containerRef}
      className="joystick-container"
      onMouseDown={handleMouseDown}
      onTouchStart={handleTouchStart}
      aria-label="Virtual joystick for player movement"
      style={{ 
        userSelect: 'none',
        WebkitUserSelect: 'none',
        WebkitTapHighlightColor: 'transparent'
      }}
    >
      <div className="joystick-base">
        <div ref={knobRef} className="joystick-knob" />
      </div>
    </button>
  );
};

export default Joystick;