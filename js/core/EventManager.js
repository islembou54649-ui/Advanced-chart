/**
 * EventManager.js
 * Centralized event handling for mouse, touch, keyboard, and wheel.
 *
 * TradingView-style interaction model:
 *  - Left-click drag = PAN the chart (default behavior)
 *  - Hover = crosshair follows cursor
 *  - Click on a drawing (no tool active) = select & drag it
 *  - Active tool = draw mode
 *  - Wheel = zoom; Shift+wheel = pan horizontally
 *  - Pinch (touch) = zoom
 *
 * Movement threshold prevents accidental pan on simple clicks.
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
        this.draggedSinceDown = false;
        this.moveThreshold = 3; // px — below this we treat as click, not drag

        // The action being performed during the current pointer-down sequence
        // 'pan' | 'draw' | 'select-drag' | 'none'
        this.activeAction = 'none';

        // For select-drag: which drawing handle/anchor is being moved
        this._dragTarget = null;
        this._dragAnchorIndex = -1;

        // Multi-touch pinch
        this.pinchStartDist = 0;
        this.pinchStartSpacing = 0;
        this.pinchStartMid = null;

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
        this.element.style.touchAction = 'none';
    }

    _getPos(e) {
        const rect = this.element.getBoundingClientRect();
        return { x: e.clientX - rect.left, y: e.clientY - rect.top };
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
        this.draggedSinceDown = false;

        // FIX: Check if we clicked on a pane button (indicator controls) first.
        // These are small buttons drawn on canvas next to the indicator name.
        if (this.engine.handlePaneButtonClick(x, y)) {
            this.activeAction = 'none';
            return;
        }

        // Decide what action to start
        if (this.engine.activeTool) {
            this.activeAction = 'draw';
            this.engine.drawingManager.onPointerDown(x, y, this.engine.activeTool);
        } else if (e.button === 2 || e.shiftKey) {
            // Right button or shift = force pan
            this.activeAction = 'pan';
        } else {
            // Default: check if we clicked on a drawing (for select/drag).
            // Otherwise pan. The decision happens on first move with threshold.
            this.activeAction = 'pending';
            this._dragTarget = this.engine.drawingManager
                ? this.engine.drawingManager.hitTestTopMost(x, y)
                : null;
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
            const totalMove = Math.abs(x - this.downX) + Math.abs(y - this.downY);
            if (totalMove > this.moveThreshold) this.draggedSinceDown = true;

            // Resolve pending action once movement exceeds threshold
            if (this.activeAction === 'pending' && this.draggedSinceDown) {
                if (this._dragTarget) {
                    this.activeAction = 'select-drag';
                    // FIX: determine which handle we grabbed ONCE at drag start.
                    // This prevents both anchors from moving together.
                    this.engine.drawingManager.startDrag(this._dragTarget, this.downX, this.downY);
                } else {
                    this.activeAction = 'pan';
                }
            }

            if (this.activeAction === 'pan') {
                // FIX: was panBy(-dx) which made dragging reversed (drag right → saw newer bars).
                // TradingView behavior: drag right → chart follows cursor → see OLDER bars.
                // panBy(dx) decreases scrollPosition when dx>0, showing older bars. Correct.
                this.engine.viewport.panBy(dx);
                this.engine.viewport.updatePriceRange(this.engine.dataManager);
                if (!this.engine.viewport.autoScale && dy !== 0) {
                    const range = this.engine.viewport.priceRange;
                    const span = range.max - range.min;
                    const shift = (dy / this.engine.viewport.priceHeight) * span;
                    this.engine.viewport.priceRange = { min: range.min + shift, max: range.max + shift };
                }
            } else if (this.activeAction === 'draw') {
                this.engine.drawingManager.onPointerMove(x, y);
            } else if (this.activeAction === 'select-drag' && this._dragTarget) {
                this.engine.drawingManager.dragDrawing(this._dragTarget, x, y, dx, dy);
            }
            this.lastPointerX = x;
            this.lastPointerY = y;
        } else {
            // Hover only — update crosshair and drawing hover state
            if (this.engine.drawingManager && this.engine.activeTool) {
                this.engine.drawingManager.onPointerHover(x, y);
            } else if (this.engine.drawingManager) {
                this.engine.drawingManager.updateHover(x, y);
            }
        }

        this.engine.crosshair.update(x, y, this.pointerInside);
        this.engine.requestRender();
    }

    _onPointerUp(e) {
        const { x, y } = this._getPos(e);

        if (this.activeAction === 'draw') {
            this.engine.drawingManager.onPointerUp(x, y);
        } else if (this.activeAction === 'pending' && !this.draggedSinceDown) {
            // It was a click, not a drag — try to select/deselect a drawing
            this.engine.drawingManager.handleClick(x, y);
        } else if (this.activeAction === 'select-drag') {
            // End the drag — clear the handle index
            this.engine.drawingManager.endDrag();
        }
        this.isPointerDown = false;
        this.activeAction = 'none';
        this._dragTarget = null;
        this.engine.requestRender();
    }

    _onPointerLeave() {
        this.pointerInside = false;
        this.engine.crosshair.visible = false;
        this.engine.requestRender();
    }

    _onWheel(e) {
        e.preventDefault();
        const { x, y } = this._getPos(e);
        if (e.ctrlKey) {
            const factor = e.deltaY < 0 ? 1.1 : 0.9;
            this.engine.viewport.zoomAt(x, factor);
        } else if (e.shiftKey) {
            // Shift + wheel = horizontal pan
            this.engine.viewport.panBy(e.deltaY);
        } else if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
            this.engine.viewport.panBy(e.deltaX);
        } else {
            const factor = e.deltaY < 0 ? 1.15 : 0.87;
            this.engine.viewport.zoomAt(x, factor);
        }
        this.engine.viewport.updatePriceRange(this.engine.dataManager);
        this.engine.requestRender();
    }

    _onContextMenu(e) {
        e.preventDefault();
        // FIX: Right-click on a drawing selects it and shows the settings card.
        // Right-click on empty chart does nothing (just prevents browser menu).
        const { x, y } = this._getPos(e);
        const drawing = this.engine.drawingManager.hitTestTopMost(x, y);
        if (drawing) {
            // Select this drawing and show its settings card
            this.engine.drawingManager.handleClick(x, y);
            if (this.engine.drawingManager.selectedId === drawing.id) {
                this.engine.settingsCard.show(drawing);
            }
        } else {
            // If a settings card is open and user right-clicks elsewhere, hide it
            this.engine.settingsCard.hide();
        }
        this.engine.requestRender();
    }

    _onKeyDown(e) {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') return;
        if (e.key === 'Escape' && this.engine.drawingManager) {
            this.engine.drawingManager.cancelDrawing();
            this.engine.setActiveTool(null);
        }
        if ((e.key === 'Delete' || e.key === 'Backspace') && this.engine.drawingManager.selectedId) {
            this.engine.drawingManager.deleteSelected();
            this.engine.requestRender();
        }
    }

    _onTouchStart(e) {
        if (e.touches.length === 2) {
            e.preventDefault();
            const [t1, t2] = [e.touches[0], e.touches[1]];
            this.pinchStartDist = MathUtils.distance(t1.clientX, t1.clientY, t2.clientX, t2.clientY);
            this.pinchStartSpacing = this.engine.viewport.barSpacing;
            const rect = this.element.getBoundingClientRect();
            this.pinchStartMid = {
                x: ((t1.clientX + t2.clientX) / 2) - rect.left,
                y: ((t1.clientY + t2.clientY) / 2) - rect.top
            };
            // Cancel any in-progress draw/select
            this.activeAction = 'none';
        }
    }

    _onTouchMove(e) {
        if (e.touches.length === 2) {
            e.preventDefault();
            const [t1, t2] = [e.touches[0], e.touches[1]];
            const dist = MathUtils.distance(t1.clientX, t1.clientY, t2.clientX, t2.clientY);
            if (this.pinchStartDist > 0 && this.pinchStartMid) {
                const factor = dist / this.pinchStartDist;
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
            this.pinchStartMid = null;
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
