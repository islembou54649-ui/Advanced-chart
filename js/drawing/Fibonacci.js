/**
 * Fibonacci.js
 * Fibonacci retracement drawing.
 * Two anchors (high + low). Draws horizontal lines at the standard fib levels:
 * 0, 0.236, 0.382, 0.5, 0.618, 0.786, 1, 1.618, 2.618
 * Each level has a price label.
 */
import { DrawingBase } from './DrawingBase.js';
import { MathUtils } from '../utils/MathUtils.js';

const FIB_LEVELS = [
    { level: 0,    color: '#888888', label: '0' },
    { level: 0.236, color: '#f23645', label: '0.236' },
    { level: 0.382, color: '#ff9800', label: '0.382' },
    { level: 0.5,  color: '#4caf50', label: '0.5' },
    { level: 0.618, color: '#089981', label: '0.618' },
    { level: 0.786, color: '#2962ff', label: '0.786' },
    { level: 1,    color: '#888888', label: '1' },
    { level: 1.618, color: '#9c27b0', label: '1.618' },
    { level: 2.618, color: '#673ab7', label: '2.618' }
];

export class Fibonacci extends DrawingBase {
    constructor(options = {}) {
        super(options);
        this.type = 'fibonacci';
        this.lineWidth = options.lineWidth || 1;
        this.showLabels = options.showLabels !== false;
        this.fillBackground = options.fillBackground !== false;
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
        const price1 = this.anchors[0].price;
        const price2 = this.anchors[1].price;
        const xLeft = Math.min(p1.x, p2.x);
        const xRight = Math.max(p1.x, p2.x);
        const xRightEdge = viewport.width - 70;

        ctx.save();
        ctx.font = "10px 'JetBrains Mono', monospace";

        // Background fill between levels (light)
        if (this.fillBackground) {
            for (let i = 0; i < FIB_LEVELS.length - 1; i++) {
                const y1 = viewport.priceToY(price1 + (price2 - price1) * FIB_LEVELS[i].level);
                const y2 = viewport.priceToY(price1 + (price2 - price1) * FIB_LEVELS[i + 1].level);
                ctx.fillStyle = this._withAlpha(FIB_LEVELS[i].color, 0.04);
                ctx.fillRect(xLeft, Math.min(y1, y2), xRight - xLeft, Math.abs(y2 - y1));
            }
        }

        // Lines + labels
        for (const fl of FIB_LEVELS) {
            const price = price1 + (price2 - price1) * fl.level;
            const y = viewport.priceToY(price);
            ctx.strokeStyle = fl.color;
            ctx.lineWidth = this.lineWidth + (this.isSelected && fl.level === 0.618 ? 1 : 0);
            this._applyLineStyle(ctx);
            ctx.beginPath();
            ctx.moveTo(xLeft, y + 0.5);
            ctx.lineTo(xRightEdge, y + 0.5);
            ctx.stroke();
            ctx.setLineDash([]);

            if (this.showLabels) {
                const label = `${fl.label}  ${MathUtils.formatPrice(price)}`;
                const m = ctx.measureText(label);
                const w = m.width + 10;
                const h = 14;
                ctx.fillStyle = fl.color;
                ctx.fillRect(xRightEdge - w, y - h / 2, w, h);
                ctx.fillStyle = '#fff';
                ctx.textAlign = 'right';
                ctx.textBaseline = 'middle';
                ctx.fillText(label, xRightEdge - 5, y);
            }
        }

        if (this.isSelected || this.isHovered || !this.isComplete) {
            this._drawHandle(ctx, p1.x, p1.y, theme);
            this._drawHandle(ctx, p2.x, p2.y, theme);
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
        const price1 = this.anchors[0].price;
        const price2 = this.anchors[1].price;
        for (const fl of FIB_LEVELS) {
            const lineY = viewport.priceToY(price1 + (price2 - price1) * fl.level);
            if (Math.abs(y - lineY) <= this._hitTolerance && x < viewport.width - 70) return true;
        }
        return false;
    }
}
