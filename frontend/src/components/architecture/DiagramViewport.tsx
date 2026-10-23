import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../lib/utils';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';

const MIN_SCALE = 0.15;
const MAX_SCALE = 4;
const ZOOM_STEP = 1.2;
const FIT_PADDING = 32;

export interface DiagramViewportProps {
  children: ReactNode;
  /** Re-fit when this changes (e.g. mermaid source or image url). */
  contentKey?: string | number;
  className?: string;
  /** Extra toolbar actions (right side). */
  toolbarExtra?: ReactNode;
  empty?: boolean;
}

interface Transform {
  x: number;
  y: number;
  scale: number;
}

/**
 * Pan / zoom stage for large diagrams or images.
 * Wheel zooms toward cursor; drag pans; toolbar fits / zooms / fullscreen.
 */
export function DiagramViewport({
  children,
  contentKey,
  className,
  toolbarExtra,
  empty = false,
}: DiagramViewportProps) {
  const { t } = useTranslation();
  const viewportRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [transform, setTransform] = useState<Transform>({
    x: 0,
    y: 0,
    scale: 1,
  });
  const transformRef = useRef(transform);
  transformRef.current = transform;

  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);
  const pendingFitRef = useRef(true);
  const [dragging, setDragging] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const measureContent = useCallback(() => {
    const content = contentRef.current;
    if (!content) return null;
    const child = content.firstElementChild as HTMLElement | SVGSVGElement | null;
    if (!child) return null;

    if (child instanceof SVGSVGElement) {
      const w =
        child.clientWidth ||
        Number(child.getAttribute('width')) ||
        child.viewBox.baseVal.width;
      const h =
        child.clientHeight ||
        Number(child.getAttribute('height')) ||
        child.viewBox.baseVal.height;
      if (w > 0 && h > 0) return { width: w, height: h };
      try {
        const box = child.getBBox();
        if (box.width > 0 && box.height > 0) {
          return { width: box.width, height: box.height };
        }
      } catch {
        /* not rendered yet */
      }
    }

    const width =
      'offsetWidth' in child
        ? child.offsetWidth || child.scrollWidth
        : child.clientWidth || child.scrollWidth;
    const height =
      'offsetHeight' in child
        ? child.offsetHeight || child.scrollHeight
        : child.clientHeight || child.scrollHeight;
    if (width > 0 && height > 0) return { width, height };
    return null;
  }, []);

  const fit = useCallback(() => {
    const viewport = viewportRef.current;
    const size = measureContent();
    if (!viewport || !size) return false;

    const vw = viewport.clientWidth;
    const vh = viewport.clientHeight;
    if (vw <= 0 || vh <= 0) return false;

    const scale = Math.min(
      (vw - FIT_PADDING * 2) / size.width,
      (vh - FIT_PADDING * 2) / size.height,
      1,
    );
    const clamped = Math.max(MIN_SCALE, scale);
    setTransform({
      scale: clamped,
      x: (vw - size.width * clamped) / 2,
      y: (vh - size.height * clamped) / 2,
    });
    pendingFitRef.current = false;
    return true;
  }, [measureContent]);

  const zoomAt = useCallback((clientX: number, clientY: number, factor: number) => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    pendingFitRef.current = false;
    const rect = viewport.getBoundingClientRect();
    const px = clientX - rect.left;
    const py = clientY - rect.top;
    setTransform((prev) => {
      const nextScale = Math.min(
        MAX_SCALE,
        Math.max(MIN_SCALE, prev.scale * factor),
      );
      if (nextScale === prev.scale) return prev;
      const ratio = nextScale / prev.scale;
      return {
        scale: nextScale,
        x: px - (px - prev.x) * ratio,
        y: py - (py - prev.y) * ratio,
      };
    });
  }, []);

  const zoomBy = useCallback(
    (factor: number) => {
      const viewport = viewportRef.current;
      if (!viewport) return;
      const rect = viewport.getBoundingClientRect();
      zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, factor);
    },
    [zoomAt],
  );

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (empty || event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (target.closest('[data-viewport-toolbar]')) return;

    pendingFitRef.current = false;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: transformRef.current.x,
      originY: transformRef.current.y,
    };
    setDragging(true);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    setTransform({
      ...transformRef.current,
      x: drag.originX + (event.clientX - drag.startX),
      y: drag.originY + (event.clientY - drag.startY),
    });
  };

  const endDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    setDragging(false);
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      /* already released */
    }
  };

  const toggleFullscreen = async () => {
    const el = viewportRef.current;
    if (!el) return;
    try {
      if (!document.fullscreenElement) {
        await el.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch {
      /* browser denied */
    }
  };

  useEffect(() => {
    const onFs = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
      window.requestAnimationFrame(() => fit());
    };
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, [fit]);

  // New content → request one auto-fit once the SVG/image is measurable.
  useEffect(() => {
    pendingFitRef.current = true;
    if (empty) return;
    const timers = [
      window.setTimeout(() => {
        if (pendingFitRef.current) fit();
      }, 50),
      window.setTimeout(() => {
        if (pendingFitRef.current) fit();
      }, 250),
    ];
    return () => {
      for (const id of timers) window.clearTimeout(id);
    };
  }, [contentKey, empty, fit]);

  useEffect(() => {
    const content = contentRef.current;
    if (!content || empty) return;
    const observer = new ResizeObserver(() => {
      if (pendingFitRef.current) fit();
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, [empty, fit, contentKey]);

  // Non-passive wheel so we can prevent page scroll while zooming.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || empty) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const factor = event.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
      zoomAt(event.clientX, event.clientY, factor);
    };
    stage.addEventListener('wheel', onWheel, { passive: false });
    return () => stage.removeEventListener('wheel', onWheel);
  }, [empty, zoomAt]);

  const percent = Math.round(transform.scale * 100);

  return (
    <div
      ref={viewportRef}
      className={cn(
        'relative flex min-h-0 flex-col overflow-hidden rounded-card border border-border bg-surface-muted',
        className,
      )}
    >
      <div
        data-viewport-toolbar
        className="absolute inset-x-0 top-0 z-10 flex flex-wrap items-center justify-between gap-2 border-b border-border/80 bg-surface/90 px-2 py-1.5 backdrop-blur-sm"
      >
        <div className="flex flex-wrap items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            aria-label={t('architecture.zoomOut')}
            title={t('architecture.zoomOut')}
            disabled={empty}
            onClick={() => zoomBy(1 / ZOOM_STEP)}
            iconLeft={<Icon name="zoom-out" size={14} />}
          />
          <span className="min-w-12 text-center text-meta tabular-nums text-fg-muted">
            {empty ? '—' : `${percent}%`}
          </span>
          <Button
            variant="ghost"
            size="sm"
            aria-label={t('architecture.zoomIn')}
            title={t('architecture.zoomIn')}
            disabled={empty}
            onClick={() => zoomBy(ZOOM_STEP)}
            iconLeft={<Icon name="zoom-in" size={14} />}
          />
          <Button
            variant="ghost"
            size="sm"
            disabled={empty}
            onClick={() => fit()}
            iconLeft={<Icon name="maximize" size={13} />}
          >
            {t('architecture.fitView')}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={empty}
            onClick={() => {
              pendingFitRef.current = false;
              setTransform((prev) => {
                const viewport = viewportRef.current;
                const size = measureContent();
                if (!viewport || !size) return { ...prev, scale: 1, x: 0, y: 0 };
                return {
                  scale: 1,
                  x: (viewport.clientWidth - size.width) / 2,
                  y: (viewport.clientHeight - size.height) / 2,
                };
              });
            }}
          >
            {t('architecture.zoom100')}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={empty}
            onClick={() => {
              void toggleFullscreen();
            }}
            iconLeft={
              <Icon name={isFullscreen ? 'minimize' : 'expand'} size={13} />
            }
          >
            {isFullscreen
              ? t('architecture.exitFullscreen')
              : t('architecture.fullscreen')}
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="hidden text-meta text-fg-subtle sm:inline">
            {t('architecture.viewportHint')}
          </span>
          {toolbarExtra}
        </div>
      </div>

      <div
        ref={stageRef}
        className={cn(
          'relative min-h-0 flex-1 touch-none overflow-hidden pt-10',
          empty ? 'cursor-default' : dragging ? 'cursor-grabbing' : 'cursor-grab',
        )}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onDoubleClick={(event) => {
          if (empty) return;
          zoomAt(event.clientX, event.clientY, ZOOM_STEP);
        }}
      >
        {empty ? (
          <div className="flex h-full items-center justify-center px-6 text-center text-secondary text-fg-subtle">
            {children}
          </div>
        ) : (
          <div
            ref={contentRef}
            className="absolute left-0 top-0 will-change-transform [&_img]:max-w-none [&_svg]:max-w-none"
            style={{
              transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
              transformOrigin: '0 0',
            }}
          >
            {children}
          </div>
        )}
      </div>
    </div>
  );
}
