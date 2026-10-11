/**
 * EventManager.js
 * Centralized event handling for mouse, touch, keyboard, and wheel.
 * Supports crosshair tracking, panning, zooming, and drawing tool interaction.
 *
 * Uses pointer events for unified mouse/touch/pen handling.
 */
import { MathUtils } from '../utils/MathUtils.js';

export class EventManager {
    constructor(canvas, engine) {
        this.canvas = canvas;
        this.engine = engine;
        this.element = canvas.element;

        // Current pointer state
        this.pointerX = -1;
        this.pointerY = -1;
        this.pointerInside = false;
        this.isPointerDown = false;
        this.lastPointerX = 0;
        this.lastPointerY = 0;
        this.downX = 0;
        this.downY = 0;
        this.downTime = 0;

        // Multi-touch pinch
        this.touches = new Map();
        this.pinchStartDist = 0;
        this.pinchStartSpacing = 0;

        // Mode: 'pan' | 'draw' | 'crosshair'
        this.mode = 'crosshair';

        // Bound handlers
        this._onPointerDown = this._onPointerDown.bind(this);
        this._onPointerMove = this._onPointerMove.bind(this);
        this._onPointerUp = this._onPointerUp.bind(this);
        this._onPointerLeave = this._onPointerLeave.bind(this);
        this._onWheel = this._onWheel.bind(this);
        this._onContextMenu = this._onContextMenu.bind(this);
        this._onKeyDown = this._onKeyDown.bind(this);
        this._onTouchStart = this._onTouchStart.bind(this);
        this._onTouchMove = this._onTouchMove.bind(this);
        this._onTouchEnd = this._onTouchEnd.bind(this);

        this._attach();
    }

    _attach() {
        this.element.addEventListener('pointerdown', this._onPointerDown);
        this.element.addEventListener('pointermove', this._onPointerMove);
        this.element.addEventListener('pointerup', this._onPointerUp);
        this.element.addEventListener('pointerleave', this._onPointerLeave);
        this.element.addEventListener('pointercancel', this._onPointerUp);
        this.element.addEventListener('wheel', this._onWheel, { passive: false });
        this.element.addEventListener('contextmenu', this._onContextMenu);
        this.element.addEventListener('touchstart', this._onTouchStart, { passive: false });
        this.element.addEventListener('touchmove', this._onTouchMove, { passive: false });
        this.element.addEventListener('touchend', this._onTouchEnd);
        window.addEventListener('keydown', this._onKeyDown);

        // Prevent default touch behaviors on the canvas
        this.element.style.touchAction = 'none';
    }

    _getPos(e) {
        const rect = this.element.getBoundingClientRect();
        return {
            x: e.clientX - rect.left,
            y: e.clientY - rect.top
        };
    }

    _onPointerDown(e) {
        this.element.setPointerCapture(e.pointerId);
        const { x, y } = this._getPos(e);
        this.pointerX = x;
        this.pointerY = y;
        this.isPointerDown = true;
        this.lastPointerX = x;
        this.lastPointerY = y;
        this.downX = x;
        this.downY = y;
        this.downTime = performance.now();
        this.mode = (e.button === 1 || e.button === 2 || e.shiftKey) ? 'pan' : (this.engine.activeTool ? 'draw' : 'crosshair');
        if (this.mode === 'draw' && this.engine.drawingManager) {
            this.engine.drawingManager.onPointerDown(x, y, this.engine.activeTool);
        }
        this.engine.requestRender();
    }

    _onPointerMove(e) {
        const { x, y } = this._getPos(e);
        this.pointerX = x;
        this.pointerY = y;
        this.pointerInside = true;

        if (this.isPointerDown) {
            const dx = x - this.lastPointerX;
            const dy = y - this.lastPointerY;
            if (this.mode === 'pan') {
                this.engine.viewport.panBy(-dx);
                this.engine.viewport.updatePriceRange(this.engine.dataManager);
                // Vertical pan = price scale scroll if not autoscale
                if (!this.engine.viewport.autoScale && dy !== 0) {
                    const range = this.engine.viewport.priceRange;
                    const span = range.max - range.min;
                    const shift = (dy / this.engine.viewport.priceHeight) * span;
                    this.engine.viewport.priceRange = { min: range.min + shift, max: range.max + shift };
                }
            } else if (this.mode === 'draw' && this.engine.drawingManager) {
                this.engine.drawingManager.onPointerMove(x, y);
            }
            this.lastPointerX = x;
            this.lastPointerY = y;
        } else if (this.engine.drawingManager && this.engine.activeTool) {
            // Hover preview while drawing
            this.engine.drawingManager.onPointerHover(x, y);
        }

        this.engine.crosshair.update(x, y, this.pointerInside);
        this.engine.requestRender();
    }

    _onPointerUp(e) {
        const { x, y } = this._getPos(e);
        const wasDrawing = this.mode === 'draw';
        this.isPointerDown = false;
        if (wasDrawing && this.engine.drawingManager) {
            this.engine.drawingManager.onPointerUp(x, y);
        }
        this.mode = 'crosshair';
        this.engine.requestRender();
    }

    _onPointerLeave() {
        this.pointerInside = false;
        this.engine.crosshair.visible = false;
        this.engine.requestRender();
    }

    _onWheel(e) {
        e.preventDefault();
        const { x } = this._getPos(e);
        if (e.ctrlKey) {
            // Pinch-like zoom on trackpads
            const factor = e.deltaY < 0 ? 1.1 : 0.9;
            this.engine.viewport.zoomAt(x, factor);
        } else {
            // Horizontal scroll = pan, vertical = zoom
            if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
                this.engine.viewport.panBy(e.deltaX);
            } else {
                const factor = e.deltaY < 0 ? 1.1 : 0.9;
                this.engine.viewport.zoomAt(x, factor);
            }
        }
        this.engine.viewport.updatePriceRange(this.engine.dataManager);
        this.engine.requestRender();
    }

    _onContextMenu(e) {
        e.preventDefault();
    }

    _onKeyDown(e) {
        if (e.key === 'Escape' && this.engine.drawingManager) {
            this.engine.drawingManager.cancelDrawing();
            this.engine.setActiveTool(null);
        }
    }

    // ---- Multi-touch (pinch zoom + two-finger pan) ----
    _onTouchStart(e) {
        if (e.touches.length === 2) {
            e.preventDefault();
            const [t1, t2] = [e.touches[0], e.touches[1]];
            this.pinchStartDist = MathUtils.distance(t1.clientX, t1.clientY, t2.clientX, t2.clientY);
            this.pinchStartSpacing = this.engine.viewport.barSpacing;
        }
    }

    _onTouchMove(e) {
        if (e.touches.length === 2) {
            e.preventDefault();
            const [t1, t2] = [e.touches[0], e.touches[1]];
            const dist = MathUtils.distance(t1.clientX, t1.clientY, t2.clientX, t2.clientY);
            if (this.pinchStartDist > 0) {
                const factor = dist / this.pinchStartDist;
                const rect = this.element.getBoundingClientRect();
                const cx = ((t1.clientX + t2.clientX) / 2) - rect.left;
                this.engine.viewport.barSpacing = MathUtils.clamp(
                    this.pinchStartSpacing * factor,
                    this.engine.viewport.minBarSpacing,
                    this.engine.viewport.maxBarSpacing
                );
                this.engine.viewport.updatePriceRange(this.engine.dataManager);
                this.engine.requestRender();
            }
        }
    }

    _onTouchEnd(e) {
        if (e.touches.length < 2) {
            this.pinchStartDist = 0;
        }
    }

    destroy() {
        this.element.removeEventListener('pointerdown', this._onPointerDown);
        this.element.removeEventListener('pointermove', this._onPointerMove);
        this.element.removeEventListener('pointerup', this._onPointerUp);
        this.element.removeEventListener('pointerleave', this._onPointerLeave);
        this.element.removeEventListener('wheel', this._onWheel);
        this.element.removeEventListener('contextmenu', this._onContextMenu);
        this.element.removeEventListener('touchstart', this._onTouchStart);
        this.element.removeEventListener('touchmove', this._onTouchMove);
        this.element.removeEventListener('touchend', this._onTouchEnd);
        window.removeEventListener('keydown', this._onKeyDown);
    }
}
