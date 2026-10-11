/**
 * TrendLine.js
 * A two-point line between two anchors. Used for trendlines, support/resistance.
 *
 * Includes:
 * - Endpoints drawn as small squares when selected/hovered
 * - Extension mode (extends the line beyond endpoints to chart edges)
 * - Snap-to-high/low option
 */
import { DrawingBase } from './DrawingBase.js';
import { MathUtils } from '../utils/MathUtils.js';

export class TrendLine extends DrawingBase {
    constructor(options = {}) {
        super(options);
        this.type = 'trendline';
        this.extend = options.extend || false;
        this.showPriceLabel = options.showPriceLabel !== false;
        this.color = options.color || '#2962ff';
        this.lineWidth = options.lineWidth || 1.5;
    }

    onPointerDown(x, y, viewport) {
        if (this.anchors.length === 0) {
            this.anchors.push(this._screenToAnchor(x, y, viewport));
            this.anchors.push(this._screenToAnchor(x, y, viewport));
            this.isComplete = false;
        }
    }

    onPointerMove(x, y, viewport) {
        if (!this.isComplete && this.anchors.length === 2) {
            this.anchors[1] = this._screenToAnchor(x, y, viewport);
        }
    }

    onPointerUp(x, y, viewport) {
        if (!this.isComplete) {
            this.anchors[1] = this._screenToAnchor(x, y, viewport);
            // Don't complete if both points are identical
            const a = this.anchors[0], b = this.anchors[1];
            if (Math.abs(a.index - b.index) < 0.5 && Math.abs(a.price - b.price) < 1e-6) {
                return; // wait for a real second click
            }
            this.isComplete = true;
        }
    }

    draw(ctx, viewport, theme) {
        if (!this.visible || this.anchors.length < 2) return;
        const p1 = this._anchorToScreen(this.anchors[0], viewport);
        const p2 = this._anchorToScreen(this.anchors[1], viewport);

        ctx.save();
        ctx.strokeStyle = this.color;
        ctx.lineWidth = this.lineWidth + (this.isSelected ? 1 : 0);
        this._applyLineStyle(ctx);

        let x1 = p1.x, y1 = p1.y, x2 = p2.x, y2 = p2.y;

        if (this.extend) {
            // Extend line to chart edges
            const dx = x2 - x1;
            const dy = y2 - y1;
            if (Math.abs(dx) > 0.001) {
                const tLeft = -x1 / dx;
                const tRight = (viewport.width - x1) / dx;
                const t = tLeft < 0 ? tRight : tLeft;
                x2 = x1 + dx * t;
                y2 = y1 + dy * t;
                // Extend backwards too
                const t2 = tLeft < 0 ? tRight : tLeft;
                x1 = p1.x + dx * t2;
                y1 = p1.y + dy * t2;
            }
        }

        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
        ctx.setLineDash([]);

        // Endpoint squares (when selected/hovered or while drawing)
        if (this.isSelected || this.isHovered || !this.isComplete) {
            this._drawHandle(ctx, p1.x, p1.y, theme);
            this._drawHandle(ctx, p2.x, p2.y, theme);
        }

        // Price label on second point
        if (this.showPriceLabel) {
            this._drawPriceLabel(ctx, p2.x, p2.y, this.anchors[1].price, theme);
        }

        ctx.restore();
    }

    _drawHandle(ctx, x, y, theme) {
        const s = 6;
        ctx.fillStyle = theme.handleFill;
        ctx.strokeStyle = theme.handleBorder;
        ctx.lineWidth = 1.5;
        ctx.fillRect(x - s / 2, y - s / 2, s, s);
        ctx.strokeRect(x - s / 2, y - s / 2, s, s);
    }

    _drawPriceLabel(ctx, x, y, price, theme) {
        const label = MathUtils.formatPrice(price);
        ctx.font = "bold 10px 'JetBrains Mono', monospace";
        const m = ctx.measureText(label);
        const w = m.width + 10;
        const h = 16;
        ctx.fillStyle = this.color;
        ctx.fillRect(x - w / 2, y - h / 2, w, h);
        ctx.fillStyle = '#fff';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, x, y);
    }

    hitTest(x, y, viewport) {
        if (!this.visible || this.anchors.length < 2) return false;
        const p1 = this._anchorToScreen(this.anchors[0], viewport);
        const p2 = this._anchorToScreen(this.anchors[1], viewport);
        // Distance from point to line segment
        const dist = this._pointToSegmentDist(x, y, p1.x, p1.y, p2.x, p2.y);
        return dist <= this._hitTolerance;
    }

    _pointToSegmentDist(px, py, x1, y1, x2, y2) {
        const dx = x2 - x1, dy = y2 - y1;
        const len2 = dx * dx + dy * dy;
        if (len2 === 0) return MathUtils.distance(px, py, x1, y1);
        let t = ((px - x1) * dx + (py - y1) * dy) / len2;
        t = MathUtils.clamp(t, 0, 1);
        const cx = x1 + t * dx, cy = y1 + t * dy;
        return MathUtils.distance(px, py, cx, cy);
    }
}
