/**
 * DrawingBase.js
 * Base class for all drawing objects (trend lines, fibs, rectangles, etc.).
 *
 * Each drawing stores its "anchor points" as logical (barIndex, price) pairs.
 * On render, it converts those to screen pixels via the viewport.
 * This way, drawings stay attached to the chart as you pan/zoom.
 *
 * Lifecycle:
 *  1. onPointerDown(x, y) - create the first anchor
 *  2. onPointerMove(x, y) - update the in-progress anchor (drawing being built)
 *  3. onPointerUp(x, y)   - finalize the drawing
 *  4. draw(ctx, viewport, theme) - render
 *  5. hitTest(x, y) - returns true if (x,y) is on this drawing (for selection/move)
 *
 * For "thousands of drawings" performance: each drawing only needs to be
 * drawn if any of its anchors are within the visible range. The DrawingManager
 * handles culling.
 */
export class DrawingBase {
    constructor(options = {}) {
        this.id = options.id || (DrawingBase._idCounter++);
        this.type = 'base';
        this.anchors = [];          // array of { index, price }
        this.isComplete = false;
        this.isSelected = false;
        this.isHovered = false;
        this.color = options.color || null;
        this.lineWidth = options.lineWidth || 1.5;
        this.lineStyle = options.lineStyle || 'solid'; // solid | dashed | dotted
        this.visible = true;
        this.locked = false;
        this.zIndex = 100;
        // For hit-testing
        this._hitTolerance = 6;
    }

    /**
     * Convert anchor (index, price) to screen (x, y).
     */
    _anchorToScreen(anchor, viewport) {
        return {
            x: viewport.indexToX(anchor.index) + viewport.barSpacing / 2,
            y: viewport.priceToY(anchor.price)
        };
    }

    /**
     * Convert screen (x, y) to logical anchor (index, price).
     */
    _screenToAnchor(x, y, viewport) {
        return {
            index: viewport.xToIndex(x - viewport.barSpacing / 2),
            price: viewport.yToPrice(y)
        };
    }

    /**
     * Apply the line style (dashes) to the ctx.
     */
    _applyLineStyle(ctx) {
        if (this.lineStyle === 'dashed') ctx.setLineDash([6, 4]);
        else if (this.lineStyle === 'dotted') ctx.setLineDash([2, 3]);
        else ctx.setLineDash([]);
    }

    /**
     * Subclasses implement these.
     */
    onPointerDown(x, y, viewport) {}
    onPointerMove(x, y, viewport) {}
    onPointerUp(x, y, viewport) {}
    draw(ctx, viewport, theme) {}
    hitTest(x, y, viewport) { return false; }
    getAnchorsInView(viewport) {
        const left = viewport.leftEdge;
        const right = viewport.rightEdge;
        return this.anchors.some(a => a.index >= left - 50 && a.index <= right + 50);
    }
}
DrawingBase._idCounter = 1;
