/**
 * Polyline.js - Multi-point polyline. Click to add points, double-click to finish.
 */
import { DrawingBase } from './DrawingBase.js';

export class Polyline extends DrawingBase {
    constructor(opts = {}) {
        super(opts);
        this.type = 'polyline';
        this.color = opts.color || '#2962ff';
    }
    onPointerDown(x, y, vp) {
        if (this.anchors.length === 0) {
            this.anchors.push(this._screenToAnchor(x, y, vp));
            this.isComplete = false;
        } else if (!this.isComplete) {
            // Add new point on each click
            this.anchors.push(this._screenToAnchor(x, y, vp));
        }
    }
    onPointerMove(x, y, vp) {
        if (!this.isComplete && this.anchors.length > 0) {
            // Update a "preview" last point
            if (this.anchors._preview) {
                this.anchors[this.anchors.length - 1] = this._screenToAnchor(x, y, vp);
            } else {
                this.anchors.push(this._screenToAnchor(x, y, vp));
                this.anchors._preview = true;
            }
        }
    }
    onPointerUp(x, y, vp) {
        // Right-click or double-click handled elsewhere; on normal up we keep adding
        if (this.anchors._preview) {
            this.anchors._preview = false;
        }
    }
    complete() {
        if (this.anchors._preview) {
            this.anchors.pop();
            this.anchors._preview = false;
        }
        if (this.anchors.length >= 2) this.isComplete = true;
    }
    draw(ctx, vp, theme) {
        if (!this.visible || this.anchors.length < 2) return;
        ctx.save();
        ctx.strokeStyle = this.color;
        ctx.lineWidth = this.lineWidth + (this.isSelected ? 1 : 0);
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        this._applyLineStyle(ctx);
        ctx.beginPath();
        const p0 = this._anchorToScreen(this.anchors[0], vp);
        ctx.moveTo(p0.x, p0.y);
        for (let i = 1; i < this.anchors.length; i++) {
            const p = this._anchorToScreen(this.anchors[i], vp);
            ctx.lineTo(p.x, p.y);
        }
        ctx.stroke();
        ctx.setLineDash([]);
        if (this.isSelected || this.isHovered) {
            for (const a of this.anchors) {
                const p = this._anchorToScreen(a, vp);
                this._drawHandle(ctx, p.x, p.y, theme);
            }
        }
        ctx.restore();
    }
    hitTest(x, y, vp) {
        if (!this.visible || this.anchors.length < 2) return false;
        for (let i = 1; i < this.anchors.length; i++) {
            const p1 = this._anchorToScreen(this.anchors[i - 1], vp);
            const p2 = this._anchorToScreen(this.anchors[i], vp);
            const dx = p2.x - p1.x, dy = p2.y - p1.y;
            const len2 = dx * dx + dy * dy;
            if (len2 === 0) continue;
            let t = ((x - p1.x) * dx + (y - p1.y) * dy) / len2;
            t = Math.max(0, Math.min(1, t));
            const cx = p1.x + t * dx, cy = p1.y + t * dy;
            if ((x - cx) * (x - cx) + (y - cy) * (y - cy) <= this._hitTolerance * this._hitTolerance) return true;
        }
        return false;
    }
}
