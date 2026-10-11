/**
 * StatusBar.js
 * Bottom status bar showing cursor coordinates, drawing count, FPS.
 * Helpful for power users and for debugging performance.
 */
import { DomUtils } from '../utils/DomUtils.js';
import { MathUtils } from '../utils/MathUtils.js';

export class StatusBar {
    constructor(container) {
        this.element = DomUtils.el('div', { class: 'ac-statusbar' });
        container.appendChild(this.element);
        this._content = {
            left: DomUtils.el('div', { class: 'ac-statusbar-left' }),
            right: DomUtils.el('div', { class: 'ac-statusbar-right' })
        };
        this.element.append(this._content.left, this._content.right);
        this._cursorPrice = '—';
        this._cursorIndex = '—';
        this._drawings = 0;
        this._bars = 0;
        this._fps = 0;
    }

    setCursor(price, index) {
        this._cursorPrice = price != null ? MathUtils.formatPrice(price) : '—';
        this._cursorIndex = index != null ? '#' + index : '—';
        this._render();
    }

    setDrawings(count) {
        this._drawings = count;
        this._render();
    }

    setBars(count) {
        this._bars = count;
        this._render();
    }

    setFps(fps) {
        this._fps = fps;
        this._render();
    }

    _render() {
        this._content.left.innerHTML = `
            <span>Bars: <b>${this._bars}</b></span>
            <span>Drawings: <b>${this._drawings}</b></span>
            <span>Cursor: <b>${this._cursorPrice}</b> @ ${this._cursorIndex}</span>
        `;
        this._content.right.innerHTML = `
            <span>FPS: <b>${this._fps}</b></span>
            <span>Advanced Chart v0.1</span>
        `;
    }
}
