/**
 * Fibonacci.js - Fibonacci retracement: two anchors (swing high/low).
 * Levels: 0, 0.236, 0.382, 0.5, 0.618, 0.786, 1, 1.618, 2.618
 */
import { DrawingBase } from './DrawingBase.js';
import { MathUtils } from '../utils/MathUtils.js';

const FIB_LEVELS = [
    { l: 0,    c: '#888' },     { l: 0.236, c: '#f23645' },
    { l: 0.382, c: '#ff9800' }, { l: 0.5,   c: '#4caf50' },
    { l: 0.618, c: '#089981' }, { l: 0.786, c: '#2962ff' },
    { l: 1,    c: '#888' },     { l: 1.618, c: '#9c27b0' },
    { l: 2.618, c: '#673ab7' }
];

export class Fibonacci extends DrawingBase {
    constructor(opts = {}) {
        super(opts);
        this.type = 'fibonacci';
        this.lineWidth = opts.lineWidth || 1;
        this.showLabels = opts.showLabels !== false;
    }
    onPointerDown(x, y, vp) {
        if (this.anchors.length === 0) {
            this.anchors.push(this._screenToAnchor(x, y, vp));
            this.anchors.push(this._screenToAnchor(x, y, vp));
            this.isComplete = false;
        }
    }
    onPointerMove(x, y, vp) {
        if (!this.isComplete && this.anchors.length === 2) this.anchors[1] = this._screenToAnchor(x, y, vp);
    }
    onPointerUp(x, y, vp) {
        if (!this.isComplete) {
            this.anchors[1] = this._screenToAnchor(x, y, vp);
            this.isComplete = true;
        }
    }
    draw(ctx, vp, theme) {
        if (!this.visible || this.anchors.length < 2) return;
        const p1 = this._anchorToScreen(this.anchors[0], vp);
        const p2 = this._anchorToScreen(this.anchors[1], vp);
        const price1 = this.anchors[0].price, price2 = this.anchors[1].price;
        const xLeft = Math.min(p1.x, p2.x);
        const xRight = vp.width - 70;
        ctx.save();
        ctx.globalAlpha = this.opacity;
        ctx.font = "10px 'JetBrains Mono', monospace";
        for (const fl of FIB_LEVELS) {
            const price = price1 + (price2 - price1) * fl.l;
            const y = vp.priceToY(price);
            ctx.strokeStyle = fl.c;
            ctx.lineWidth = fl.l === 0.618 ? this.lineWidth + 0.5 : this.lineWidth;
            this._applyLineStyle(ctx);
            ctx.beginPath();
            ctx.moveTo(xLeft, y + 0.5);
            ctx.lineTo(xRight, y + 0.5);
            ctx.stroke();
            ctx.setLineDash([]);
            if (this.showLabels) {
                const lbl = `${(fl.l * 100).toFixed(1)}%  ${MathUtils.formatPrice(price)}`;
                const m = ctx.measureText(lbl);
                const w = m.width + 10, h = 14;
                ctx.fillStyle = fl.c;
                ctx.fillRect(xRight - w, y - h / 2, w, h);
                ctx.fillStyle = '#fff';
                ctx.textAlign = 'right';
                ctx.textBaseline = 'middle';
                ctx.fillText(lbl, xRight - 5, y);
            }
        }
        if (this.isSelected || this.isHovered || !this.isComplete) {
            this._drawHandle(ctx, p1.x, p1.y, theme);
            this._drawHandle(ctx, p2.x, p2.y, theme);
        }
        ctx.restore();
    }
    hitTest(x, y, vp) {
        if (!this.visible || this.anchors.length < 2) return false;
        const price1 = this.anchors[0].price, price2 = this.anchors[1].price;
        for (const fl of FIB_LEVELS) {
            const lineY = vp.priceToY(price1 + (price2 - price1) * fl.l);
            if (Math.abs(y - lineY) <= this._hitTolerance && x < vp.width - 70) return true;
        }
        return false;
    }
}
