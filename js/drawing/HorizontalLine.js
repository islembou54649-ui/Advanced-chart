/**
 * HorizontalLine.js
 * A horizontal line at a specific price, spanning the entire chart width.
 * Common use: support/resistance levels, take-profit / stop-loss markers.
 */
import { DrawingBase } from './DrawingBase.js';
import { MathUtils } from '../utils/MathUtils.js';

export class HorizontalLine extends DrawingBase {
    constructor(options = {}) {
        super(options);
        this.type = 'hline';
        this.color = options.color || '#ff9800';
        this.lineWidth = options.lineWidth || 1.5;
        this.showLabel = options.showLabel !== false;
        this.lineStyle = options.lineStyle || 'dashed';
    }

    onPointerDown(x, y, viewport) {
        if (this.anchors.length === 0) {
            this.anchors.push(this._screenToAnchor(x, y, viewport));
            this.isComplete = true; // single-click completion
        }
    }

    onPointerMove(x, y, viewport) {
        if (!this.isComplete && this.anchors.length === 1) {
            this.anchors[0] = this._screenToAnchor(x, y, viewport);
        }
    }

    onPointerUp(x, y, viewport) {
        if (!this.isComplete && this.anchors.length === 1) {
            this.anchors[0] = this._screenToAnchor(x, y, viewport);
            this.isComplete = true;
        }
    }

    draw(ctx, viewport, theme) {
        if (!this.visible || this.anchors.length < 1) return;
        const y = viewport.priceToY(this.anchors[0].price);
        if (y < 0 || y > viewport.priceHeight) return;

        ctx.save();
        ctx.strokeStyle = this.color;
        ctx.lineWidth = this.lineWidth + (this.isSelected ? 1 : 0);
        this._applyLineStyle(ctx);
        ctx.beginPath();
        ctx.moveTo(0, y + 0.5);
        ctx.lineTo(viewport.width - 70, y + 0.5);
        ctx.stroke();
        ctx.setLineDash([]);

        if (this.showLabel) {
            const label = MathUtils.formatPrice(this.anchors[0].price);
            ctx.font = "bold 11px 'JetBrains Mono', monospace";
            const m = ctx.measureText(label);
            const w = m.width + 12;
            const h = 18;
            const x = viewport.width - 70;
            ctx.fillStyle = this.color;
            ctx.fillRect(x, y - h / 2, w, h);
            ctx.fillStyle = '#fff';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(label, x + w / 2, y);
        }

        if (this.isSelected || this.isHovered) {
            // Handle on left edge
            const s = 6;
            ctx.fillStyle = theme.handleFill;
            ctx.strokeStyle = theme.handleBorder;
            ctx.lineWidth = 1.5;
            ctx.fillRect(0, y - s / 2, s, s);
            ctx.strokeRect(0, y - s / 2, s, s);
        }
        ctx.restore();
    }

    hitTest(x, y, viewport) {
        if (!this.visible || this.anchors.length < 1) return false;
        const lineY = viewport.priceToY(this.anchors[0].price);
        return Math.abs(y - lineY) <= this._hitTolerance && x < viewport.width - 70;
    }
}
