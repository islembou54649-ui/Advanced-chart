/**
 * Rectangle.js
 * Rectangle drawing with two anchors (top-left, bottom-right).
 * Used for highlighting ranges, support/resistance zones, etc.
 */
import { DrawingBase } from './DrawingBase.js';

export class Rectangle extends DrawingBase {
    constructor(options = {}) {
        super(options);
        this.type = 'rectangle';
        this.color = options.color || '#2962ff';
        this.fillColor = options.fillColor || null;
        this.fillOpacity = options.fillOpacity || 0.15;
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
            this.isComplete = true;
        }
    }

    draw(ctx, viewport, theme) {
        if (!this.visible || this.anchors.length < 2) return;
        const p1 = this._anchorToScreen(this.anchors[0], viewport);
        const p2 = this._anchorToScreen(this.anchors[1], viewport);
        const x = Math.min(p1.x, p2.x);
        const y = Math.min(p1.y, p2.y);
        const w = Math.abs(p2.x - p1.x);
        const h = Math.abs(p2.y - p1.y);

        ctx.save();
        // Fill
        if (this.fillColor) {
            ctx.fillStyle = this._withAlpha(this.fillColor, this.fillOpacity);
            ctx.fillRect(x, y, w, h);
        } else {
            ctx.fillStyle = this._withAlpha(this.color, this.fillOpacity);
            ctx.fillRect(x, y, w, h);
        }
        // Border
        ctx.strokeStyle = this.color;
        ctx.lineWidth = this.lineWidth + (this.isSelected ? 1 : 0);
        this._applyLineStyle(ctx);
        ctx.strokeRect(x + 0.5, y + 0.5, w, h);
        ctx.setLineDash([]);

        if (this.isSelected || this.isHovered || !this.isComplete) {
            this._drawHandle(ctx, p1.x, p1.y, theme);
            this._drawHandle(ctx, p2.x, p2.y, theme);
            this._drawHandle(ctx, p1.x, p2.y, theme);
            this._drawHandle(ctx, p2.x, p1.y, theme);
        }
        ctx.restore();
    }

    _withAlpha(color, alpha) {
        if (color.startsWith('#')) {
            const hex = color.slice(1);
            const r = parseInt(hex.substr(0, 2), 16);
            const g = parseInt(hex.substr(2, 2), 16);
            const b = parseInt(hex.substr(4, 2), 16);
            return `rgba(${r},${g},${b},${alpha})`;
        }
        return color;
    }

    _drawHandle(ctx, x, y, theme) {
        const s = 6;
        ctx.fillStyle = theme.handleFill;
        ctx.strokeStyle = theme.handleBorder;
        ctx.lineWidth = 1.5;
        ctx.fillRect(x - s / 2, y - s / 2, s, s);
        ctx.strokeRect(x - s / 2, y - s / 2, s, s);
    }

    hitTest(x, y, viewport) {
        if (!this.visible || this.anchors.length < 2) return false;
        const p1 = this._anchorToScreen(this.anchors[0], viewport);
        const p2 = this._anchorToScreen(this.anchors[1], viewport);
        const minX = Math.min(p1.x, p2.x), maxX = Math.max(p1.x, p2.x);
        const minY = Math.min(p1.y, p2.y), maxY = Math.max(p1.y, p2.y);
        // Hit if on border (within tolerance)
        const onLeft = Math.abs(x - minX) <= this._hitTolerance && y >= minY - this._hitTolerance && y <= maxY + this._hitTolerance;
        const onRight = Math.abs(x - maxX) <= this._hitTolerance && y >= minY - this._hitTolerance && y <= maxY + this._hitTolerance;
        const onTop = Math.abs(y - minY) <= this._hitTolerance && x >= minX - this._hitTolerance && x <= maxX + this._hitTolerance;
        const onBottom = Math.abs(y - maxY) <= this._hitTolerance && x >= minX - this._hitTolerance && x <= maxX + this._hitTolerance;
        return onLeft || onRight || onTop || onBottom;
    }
}
