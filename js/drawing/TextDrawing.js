/**
 * TextDrawing.js
 * A floating text annotation anchored to a chart point.
 * Single-click placement, then prompt for text (or use default).
 */
import { DrawingBase } from './DrawingBase.js';

export class TextDrawing extends DrawingBase {
    constructor(options = {}) {
        super(options);
        this.type = 'text';
        this.text = options.text || 'Note';
        this.color = options.color || '#ffffff';
        this.bgColor = options.bgColor || 'rgba(41, 98, 255, 0.85)';
        this.fontSize = options.fontSize || 12;
        this.fontFamily = options.fontFamily || "'Inter', sans-serif";
        this.padding = 6;
    }

    onPointerDown(x, y, viewport) {
        if (this.anchors.length === 0) {
            this.anchors.push(this._screenToAnchor(x, y, viewport));
            this.isComplete = true;
            const text = prompt('Enter text:', this.text);
            if (text) this.text = text;
            else this.text = '';
        }
    }

    onPointerMove(x, y, viewport) {}
    onPointerUp(x, y, viewport) {}

    draw(ctx, viewport, theme) {
        if (!this.visible || this.anchors.length < 1 || !this.text) return;
        const p = this._anchorToScreen(this.anchors[0], viewport);
        ctx.save();
        ctx.font = `${this.fontSize}px ${this.fontFamily}`;
        const lines = this.text.split('\n');
        const lineHeight = this.fontSize * 1.3;
        const m = ctx.measureText(this.text);
        const w = m.width + this.padding * 2;
        const h = lineHeight + this.padding * 2;
        ctx.fillStyle = this.bgColor;
        ctx.fillRect(p.x, p.y - h, w, h);
        if (this.isSelected || this.isHovered) {
            ctx.strokeStyle = theme.handleBorder;
            ctx.lineWidth = 1;
            ctx.strokeRect(p.x + 0.5, p.y - h + 0.5, w, h);
        }
        ctx.fillStyle = this.color;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(this.text, p.x + this.padding, p.y - h / 2);
        ctx.restore();
    }

    hitTest(x, y, viewport) {
        if (!this.visible || this.anchors.length < 1) return false;
        const p = this._anchorToScreen(this.anchors[0], viewport);
        // Approximate hit test on the text box
        return Math.abs(x - p.x - 30) < 50 && Math.abs(y - (p.y - 10)) < 12;
    }
}
