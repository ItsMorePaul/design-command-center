import { useState, useRef } from 'react';
import { useFloating, offset, flip, shift } from '@floating-ui/react';

interface TooltipProps {
  content: string;
  children: React.ReactNode;
}

export function Tooltip({ content, children }: TooltipProps) {
  const [isMounted, setIsMounted] = useState(false);
  const showTimeoutRef = useRef<number | undefined>(undefined);
  const hideTimeoutRef = useRef<number | undefined>(undefined);

  const { refs, floatingStyles, placement } = useFloating({
    placement: 'top',
    middleware: [
      offset(12),
      flip(),
      shift({ padding: 8 }),
    ],
  });

  const isTop = placement === 'top' || placement === 'top-start' || placement === 'top-end';

  const handleMouseEnter = () => {
    clearTimeout(hideTimeoutRef.current);
    showTimeoutRef.current = window.setTimeout(() => {
      setIsMounted(true);
    }, 150);
  };

  const handleMouseLeave = () => {
    clearTimeout(showTimeoutRef.current);
    hideTimeoutRef.current = window.setTimeout(() => {
      setIsMounted(false);
    }, 150);
  };

  return (
    <>
      <div
        ref={refs.setReference}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        className="tooltip-trigger"
        style={{ display: 'inline-flex' }}
      >
        {children}
      </div>
      
      {isMounted && (
        <div
          ref={refs.setFloating}
          style={floatingStyles}
          className="tooltip-floating"
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
        >
          <div className="tooltip-content">{content}</div>
          <div className={`tooltip-arrow ${isTop ? 'tooltip-arrow-down' : 'tooltip-arrow-up'}`} />
        </div>
      )}
    </>
  );
}
