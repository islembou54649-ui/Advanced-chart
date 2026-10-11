/**
 * DrawingManager.js
 * Central manager for all drawing objects on the chart.
 *
 * Features:
 * - Spatial bucketing for fast hit-testing (supports thousands of drawings)
 * - Visible-range culling (only on-screen drawings render)
 * - Selection, hover, and drag-to-move (whole drawing or single anchor)
 * - Settings card popup when a drawing is selected
 * - Serialization (toJSON / fromJSON) for save/load
 *
 * Tool flow:
 * - setActiveTool('trendline') → click on chart starts a new drawing
 * - While drawing: pointer events build anchors
 * - On completion: tool stays active for multi-draw (Esc or right-click to exit)
 */
import { DrawingBase } from './DrawingBase.js';
import { TrendLine } from './TrendLine.js';
import { HorizontalLine } from './HorizontalLine.js';
import { VerticalLine } from './VerticalLine.js';
import { Rectangle } from './Rectangle.js';
import { Ellipse } from './Ellipse.js';
import { Triangle } from './Triangle.js';
import { Fibonacci } from './Fibonacci.js';
import { FibExtension } from './FibExtension.js';
import { FibChannel } from './FibChannel.js';
import { TextDrawing } from './TextDrawing.js';
import { Arrow } from './Arrow.js';
import { RayLine } from './RayLine.js';
import { ParallelChannel } from './ParallelChannel.js';
import { LongPosition } from './LongPosition.js';
import { ShortPosition } from './ShortPosition.js';
import { Brush } from './Brush.js';
import { Polyline } from './Polyline.js';
import { Measurement } from './Measurement.js';
import { PriceLabel } from './PriceLabel.js';
import { DateRange } from './DateRange.js';
import { Pitchfork } from './Pitchfork.js';
import { GannBox } from './GannBox.js';

export class DrawingManager {
    constructor() {
        this.drawings = [];
        this._drawingById = new Map();
        this.activeTool = null;
        this._currentDrawing = null;
        this.selectedId = null;
        this.hoveredId = null;
        this._bucketSize = 100;
        this._buckets = new Map();
        this._viewport = null;
        this.onSelectionChange = null;

        this._toolFactories = {
            // Trend & lines
            trendline: (opts) => new TrendLine(opts),
            ray: (opts) => new RayLine(opts),
            hline: (opts) => new HorizontalLine(opts),
            vline: (opts) => new VerticalLine(opts),
            arrow: (opts) => new Arrow(opts),
            brush: (opts) => new Brush(opts),
            polyline: (opts) => new Polyline(opts),
            // Shapes
            rectangle: (opts) => new Rectangle(opts),
            ellipse: (opts) => new Ellipse(opts),
            triangle: (opts) => new Triangle(opts),
            // Fibonacci
            fib: (opts) => new Fibonacci(opts),
            fibext: (opts) => new FibExtension(opts),
            fibchannel: (opts) => new FibChannel(opts),
            // Patterns
            channel: (opts) => new ParallelChannel(opts),
            pitchfork: (opts) => new Pitchfork(opts),
            gannbox: (opts) => new GannBox(opts),
            // Positions
            longpos: (opts) => new LongPosition(opts),
            shortpos: (opts) => new ShortPosition(opts),
            // Annotations
            text: (opts) => new TextDrawing(opts),
            pricelabel: (opts) => new PriceLabel(opts),
            daterange: (opts) => new DateRange(opts),
            measurement: (opts) => new Measurement(opts)
        };
    }

    setActiveTool(tool) {
        if (tool && !this._toolFactories[tool]) {
            console.warn('Unknown drawing tool:', tool);
            return;
        }
        this.activeTool = tool;
        if (!tool && this._currentDrawing) {
            this._currentDrawing = null;
        }
    }

    add(drawing) {
        this.drawings.push(drawing);
        this._drawingById.set(drawing.id, drawing);
        this._indexDrawing(drawing);
        return drawing;
    }

    remove(id) {
        const d = this._drawingById.get(id);
        if (!d) return;
        const idx = this.drawings.indexOf(d);
        if (idx >= 0) this.drawings.splice(idx, 1);
        this._drawingById.delete(id);
        this._unindexDrawing(d);
        if (this.selectedId === id) {
            this.selectedId = null;
            if (this.onSelectionChange) this.onSelectionChange(null);
        }
    }

    clear() {
        this.drawings = [];
        this._drawingById.clear();
        this._buckets.clear();
        this.selectedId = null;
        this.hoveredId = null;
        this._currentDrawing = null;
        if (this.onSelectionChange) this.onSelectionChange(null);
    }

    _indexDrawing(d) {
        // FIX: previously we only indexed the bucket that each anchor falls into.
        // That broke hit-testing for drawings whose anchors span many buckets
        // (e.g. a Trend Line drawn across the whole visible range). Clicking on
        // the middle of such a line returned no candidates and the click was
        // treated as "empty space" instead of selecting the drawing.
        // Fix: index every bucket between the min and max anchor index.
        if (d.anchors.length === 0) return;
        let minKey = Infinity, maxKey = -Infinity;
        for (const a of d.anchors) {
            const key = Math.floor(a.index / this._bucketSize);
            if (key < minKey) minKey = key;
            if (key > maxKey) maxKey = key;
        }
        // Cap to a sane upper bound so a wildly-spanning drawing doesn't blow up
        // the bucket map (e.g. an infinite ray). 200 buckets = 20_000 bars max.
        const SPAN_CAP = 200;
        if (maxKey - minKey > SPAN_CAP) maxKey = minKey + SPAN_CAP;
        for (let k = minKey; k <= maxKey; k++) {
            if (!this._buckets.has(k)) this._buckets.set(k, new Set());
            this._buckets.get(k).add(d.id);
        }
    }
    _unindexDrawing(d) {
        // Same span-based removal — must mirror _indexDrawing exactly.
        if (d.anchors.length === 0) return;
        let minKey = Infinity, maxKey = -Infinity;
        for (const a of d.anchors) {
            const key = Math.floor(a.index / this._bucketSize);
            if (key < minKey) minKey = key;
            if (key > maxKey) maxKey = key;
        }
        const SPAN_CAP = 200;
        if (maxKey - minKey > SPAN_CAP) maxKey = minKey + SPAN_CAP;
        for (let k = minKey; k <= maxKey; k++) {
            const set = this._buckets.get(k);
            if (set) set.delete(d.id);
        }
    }
    _reindexDrawing(d) {
        this._unindexDrawing(d);
        this._indexDrawing(d);
    }

    _candidatesForIndex(index) {
        const key = Math.floor(index / this._bucketSize);
        const ids = new Set();
        for (let k = key - 1; k <= key + 1; k++) {
            const s = this._buckets.get(k);
            if (s) s.forEach(id => ids.add(id));
        }
        return [...ids].map(id => this._drawingById.get(id)).filter(Boolean);
    }

    // ---- Public pointer handlers ----
    onPointerDown(x, y, tool) {
        if (tool && this._toolFactories[tool]) {
            if (!this._currentDrawing) {
                this._currentDrawing = this._toolFactories[tool]({ color: this._nextColor() });
            }
            this._currentDrawing.onPointerDown(x, y, this._viewport);
        }
    }

    onPointerMove(x, y) {
        if (this._currentDrawing) {
            this._currentDrawing.onPointerMove(x, y, this._viewport);
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
                // FIX: was staying active allowing unlimited drawings.
                // User wants: draw once, then auto-exit tool mode (back to cursor).
                // To draw again, click the tool button again.
                if (this._onToolComplete) this._onToolComplete();
            }
        }
    }

    cancelDrawing() {
        this._currentDrawing = null;
        this.activeTool = null;
    }

    /**
     * Hit-test all drawings (top-most first) and return the first match.
     */
    hitTestTopMost(x, y) {
        const idx = this._viewport.xToIndex(x);
        const candidates = this._candidatesForIndex(idx);
        // Sort by zIndex descending so top-most is first
        candidates.sort((a, b) => b.zIndex - a.zIndex);
        for (const d of candidates) {
            if (!d.visible) continue;
            if (d.hitTest(x, y, this._viewport)) return d;
            // Also check handles
            if (d.hitTestHandle && d.hitTestHandle(x, y, this._viewport) >= 0) return d;
        }
        return null;
    }

    /**
     * Update hover state (called on every pointer-move with no button down).
     */
    updateHover(x, y) {
        const d = this.hitTestTopMost(x, y);
        const newId = d ? d.id : null;
        if (newId !== this.hoveredId) {
            if (this.hoveredId) {
                const old = this._drawingById.get(this.hoveredId);
                if (old) old.isHovered = false;
            }
            if (d) d.isHovered = true;
            this.hoveredId = newId;
        }
    }

    /**
     * Handle a click (no drag) — select/deselect.
     */
    handleClick(x, y) {
        const d = this.hitTestTopMost(x, y);
        // Deselect previous
        if (this.selectedId) {
            const prev = this._drawingById.get(this.selectedId);
            if (prev) prev.isSelected = false;
        }
        if (d) {
            d.isSelected = true;
            this.selectedId = d.id;
        } else {
            this.selectedId = null;
        }
        if (this.onSelectionChange) this.onSelectionChange(this.selectedId ? d : null);
    }

    /**
     * Drag the selected drawing (whole or single anchor) by (dx, dy).
     */
    dragDrawing(drawing, x, y, dx, dy) {
        if (drawing.locked) return;
        // Check if we're dragging a specific handle
        const handleIdx = drawing.hitTestHandle(this.downX || x, this.downY || y, this._viewport);
        if (handleIdx >= 0) {
            drawing.setAnchor(handleIdx, x, y, this._viewport);
        } else {
            // Move whole drawing
            drawing.translateBy(dx, dy, this._viewport);
        }
        this._reindexDrawing(drawing);
    }

    _nextColor() {
        const palette = ['#2962ff', '#f23645', '#089981', '#ff9800', '#9c27b0', '#00bcd4', '#ffeb3b', '#e91e63'];
        return palette[this.drawings.length % palette.length];
    }

    deleteSelected() {
        if (this.selectedId) this.remove(this.selectedId);
    }

    getSelected() {
        return this.selectedId ? this._drawingById.get(this.selectedId) : null;
    }

    draw(ctx, viewport, theme) {
        const left = viewport.leftEdge - 100;
        const right = viewport.rightEdge + 100;
        const visible = [];
        for (const d of this.drawings) {
            if (!d.visible) continue;
            let inView = false;
            for (const a of d.anchors) {
                if (a.index >= left && a.index <= right) { inView = true; break; }
            }
            if (d.type === 'hline' || d.type === 'vline' || d.type === 'pricelabel') inView = true;
            if (inView) visible.push(d);
        }
        visible.sort((a, b) => a.zIndex - b.zIndex);
        for (const d of visible) d.draw(ctx, viewport, theme);
        if (this._currentDrawing) this._currentDrawing.draw(ctx, viewport, theme);
    }

    get count() { return this.drawings.length; }

    toJSON() {
        return this.drawings.map(d => d.toJSON());
    }

    fromJSON(data) {
        this.clear();
        for (const item of data) {
            const factory = this._toolFactories[item.type];
            if (factory) {
                const d = factory(item);
                this.add(d);
            }
        }
    }
}
