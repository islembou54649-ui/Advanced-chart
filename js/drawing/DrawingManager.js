/**
 * DrawingManager.js
 * Central manager for all drawing objects on the chart.
 *
 * Performance design for thousands of drawings:
 * 1. Culling: only drawings whose anchors fall within the visible range are rendered.
 * 2. Spatial bucketing: drawings are bucketed by bar-index range for fast hit-testing.
 * 3. Batched rendering: all drawings render in a single canvas pass sorted by zIndex.
 * 4. Dirty flag: avoid re-rendering when nothing changed.
 *
 * Drawing tool flow:
 * - setActiveTool('trendline') → next click starts a new trendline
 * - while drawing: pointer down/move/up build the drawing
 * - on completion: tool stays active (multi-draw) unless "one-shot" mode is set
 *
 * Selection / editing:
 * - Click on a completed drawing selects it (when no tool is active)
 * - Drag handles to move anchors (TODO in v2)
 * - Delete key removes the selected drawing
 */
import { TrendLine } from './TrendLine.js';
import { HorizontalLine } from './HorizontalLine.js';
import { Rectangle } from './Rectangle.js';
import { Fibonacci } from './Fibonacci.js';
import { TextDrawing } from './TextDrawing.js';

export class DrawingManager {
    constructor() {
        this.drawings = [];
        this._drawingById = new Map();
        this.activeTool = null;     // 'trendline' | 'hline' | 'rectangle' | 'fib' | 'text' | null
        this._currentDrawing = null;  // drawing being created right now
        this.selectedId = null;
        this.hoveredId = null;
        this._bucketSize = 100;     // bar-index bucket size for spatial hashing
        this._buckets = new Map();  // bucketKey -> Set<drawingId>

        // Register drawing constructors
        this._toolFactories = {
            trendline: (opts) => new TrendLine(opts),
            hline: (opts) => new HorizontalLine(opts),
            rectangle: (opts) => new Rectangle(opts),
            fib: (opts) => new Fibonacci(opts),
            text: (opts) => new TextDrawing(opts)
        };
    }

    /**
     * Set the active drawing tool. Pass null to exit drawing mode.
     */
    setActiveTool(tool) {
        if (tool && !this._toolFactories[tool]) {
            console.warn('Unknown drawing tool:', tool);
            return;
        }
        this.activeTool = tool;
        if (!tool && this._currentDrawing) {
            // Cancel in-progress drawing
            this._currentDrawing = null;
        }
    }

    /**
     * Add an existing drawing (e.g. loaded from storage).
     */
    add(drawing) {
        this.drawings.push(drawing);
        this._drawingById.set(drawing.id, drawing);
        this._indexDrawing(drawing);
        return drawing;
    }

    /**
     * Remove a drawing by id.
     */
    remove(id) {
        const d = this._drawingById.get(id);
        if (!d) return;
        const idx = this.drawings.indexOf(d);
        if (idx >= 0) this.drawings.splice(idx, 1);
        this._drawingById.delete(id);
        this._unindexDrawing(d);
        if (this.selectedId === id) this.selectedId = null;
    }

    /**
     * Remove all drawings.
     */
    clear() {
        this.drawings = [];
        this._drawingById.clear();
        this._buckets.clear();
        this.selectedId = null;
        this.hoveredId = null;
        this._currentDrawing = null;
    }

    /**
     * Spatial index for fast hit testing by bar index.
     */
    _indexDrawing(d) {
        for (const a of d.anchors) {
            const key = Math.floor(a.index / this._bucketSize);
            if (!this._buckets.has(key)) this._buckets.set(key, new Set());
            this._buckets.get(key).add(d.id);
        }
    }
    _unindexDrawing(d) {
        for (const a of d.anchors) {
            const key = Math.floor(a.index / this._bucketSize);
            const set = this._buckets.get(key);
            if (set) set.delete(d.id);
        }
    }

    /**
     * Get candidate drawings near a given bar index (for hit testing).
     */
    _candidatesForIndex(index) {
        const key = Math.floor(index / this._bucketSize);
        const ids = new Set();
        for (let k = key - 1; k <= key + 1; k++) {
            const s = this._buckets.get(k);
            if (s) s.forEach(id => ids.add(id));
        }
        return [...ids].map(id => this._drawingById.get(id)).filter(Boolean);
    }

    // ---- Pointer event handlers (called by EventManager) ----
    onPointerDown(x, y, tool) {
        if (tool && this._toolFactories[tool]) {
            // Reuse an in-progress drawing if one exists (supports multi-click tools
            // like the trend line, where the 2nd click finalizes the 2nd anchor).
            // Previously a brand-new drawing was created on every pointerdown, which
            // discarded the in-progress one and made the documented "click twice to
            // draw a line" flow impossible (only a drag would complete).
            if (!this._currentDrawing) {
                this._currentDrawing = this._toolFactories[tool]({ color: this._nextColor() });
            }
            // Use the engine's viewport via a property set by ChartEngine
            this._currentDrawing.onPointerDown(x, y, this._viewport);
        }
    }

    onPointerMove(x, y) {
        if (this._currentDrawing) {
            this._currentDrawing.onPointerMove(x, y, this._viewport);
        } else if (!this.activeTool) {
            // Hover detection for selection feedback
            this._updateHover(x, y);
        }
    }

    onPointerHover(x, y) {
        if (this._currentDrawing) {
            this._currentDrawing.onPointerMove(x, y, this._viewport);
        }
    }

    onPointerUp(x, y) {
        if (this._currentDrawing) {
            this._currentDrawing.onPointerUp(x, y, this._viewport);
            if (this._currentDrawing.isComplete) {
                this.add(this._currentDrawing);
                this._currentDrawing = null;
                // Stay in tool mode for multiple drawings
            }
        } else if (!this.activeTool) {
            // Try to select a drawing
            this._updateSelection(x, y);
        }
    }

    cancelDrawing() {
        this._currentDrawing = null;
        this.activeTool = null;
    }

    _updateHover(x, y) {
        const idx = this._viewport.xToIndex(x);
        const candidates = this._candidatesForIndex(idx);
        let found = null;
        for (const d of candidates) {
            if (d.hitTest(x, y, this._viewport)) { found = d; break; }
        }
        const newHover = found ? found.id : null;
        if (newHover !== this.hoveredId) {
            if (this.hoveredId) {
                const old = this._drawingById.get(this.hoveredId);
                if (old) old.isHovered = false;
            }
            if (found) found.isHovered = true;
            this.hoveredId = newHover;
        }
    }

    _updateSelection(x, y) {
        const idx = this._viewport.xToIndex(x);
        const candidates = this._candidatesForIndex(idx);
        let found = null;
        for (const d of candidates) {
            if (d.hitTest(x, y, this._viewport)) { found = d; break; }
        }
        // Deselect previous
        if (this.selectedId) {
            const prev = this._drawingById.get(this.selectedId);
            if (prev) prev.isSelected = false;
        }
        if (found) {
            found.isSelected = true;
            this.selectedId = found.id;
        } else {
            this.selectedId = null;
        }
    }

    _nextColor() {
        const palette = ['#2962ff', '#f23645', '#089981', '#ff9800', '#9c27b0', '#00bcd4'];
        return palette[this.drawings.length % palette.length];
    }

    /**
     * Delete the currently-selected drawing.
     */
    deleteSelected() {
        if (this.selectedId) this.remove(this.selectedId);
    }

    /**
     * Render all visible drawings.
     */
    draw(ctx, viewport, theme) {
        // Always render in-progress drawing on top
        const all = [];
        // Cull: skip drawings entirely outside the visible range
        const left = viewport.leftEdge - 50;
        const right = viewport.rightEdge + 50;
        for (const d of this.drawings) {
            let inView = false;
            for (const a of d.anchors) {
                if (a.index >= left && a.index <= right) { inView = true; break; }
            }
            // HorizontalLine spans all, always render
            if (d.type === 'hline') inView = true;
            if (inView) all.push(d);
        }
        all.sort((a, b) => a.zIndex - b.zIndex);
        for (const d of all) d.draw(ctx, viewport, theme);
        if (this._currentDrawing) this._currentDrawing.draw(ctx, viewport, theme);
    }

    get count() { return this.drawings.length; }
}
