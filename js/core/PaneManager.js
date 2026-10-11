/**
 * PaneManager.js
 * Manages a stack of panes: one main price pane (always at top) and any number of
 * indicator panes below. Each pane has a draggable resize handle between it and the
 * next pane, so the user can drag to resize.
 *
 * Each pane has:
 *  - id
 *  - height (in CSS pixels)
 *  - minHeight
 *  - canvas (its own drawing surface)
 *  - list of indicators rendered into it
 *
 * The main price pane contains the candle series + overlay indicators.
 * Indicator panes (e.g. RSI, MACD) live below and have their own Y-scale.
 */
import { Canvas } from '../core/Canvas.js';
import { DomUtils } from '../utils/DomUtils.js';

export class PaneManager {
    constructor(container, engine) {
        this.container = container;
        this.engine = engine;
        this.panes = [];        // array of pane objects
        this._resizeObserver = new ResizeObserver(() => this._layout());
        this._resizeObserver.observe(container);
    }

    /**
     * Initialize with a single main pane + a dedicated time axis strip at the bottom.
     */
    init(initialHeight) {
        this.panes = [];
        const main = this._createPane('main', 'Price', initialHeight, true);
        this.panes.push(main);
        // Create the time axis strip (always at the very bottom, fixed height)
        this.timeAxisPane = this._createTimeAxisPane(28);
        this._layout();
        return main;
    }

    _createTimeAxisPane(height) {
        const wrapper = DomUtils.el('div', { class: 'ac-pane ac-pane-timeaxis', dataset: { paneId: 'timeaxis' } });
        const canvasContainer = DomUtils.el('div', { class: 'ac-pane-canvas-container' });
        wrapper.appendChild(canvasContainer);
        this.container.appendChild(wrapper);
        const canvas = new Canvas(canvasContainer, { alpha: false });
        const pane = {
            id: 'timeaxis', title: 'Time', height, isMain: false, isTimeAxis: true,
            wrapper, canvasContainer, canvas,
            indicators: [], visible: true
        };
        canvas.onResize = (w, h) => { pane.width = w; pane.innerHeight = h; };
        return pane;
    }

    _createPane(id, title, height, isMain = false) {
        const wrapper = DomUtils.el('div', { class: 'ac-pane' + (isMain ? ' ac-pane-main' : ''), dataset: { paneId: id } });
        const header = DomUtils.el('div', { class: 'ac-pane-header' }, [
            DomUtils.el('span', { class: 'ac-pane-title' }, title),
            DomUtils.el('div', { class: 'ac-pane-actions' })
        ]);
        const canvasContainer = DomUtils.el('div', { class: 'ac-pane-canvas-container' });
        wrapper.appendChild(header);
        wrapper.appendChild(canvasContainer);
        this.container.appendChild(wrapper);
        const canvas = new Canvas(canvasContainer, { alpha: false });
        const pane = {
            id, title, height, isMain,
            wrapper, header, canvasContainer, canvas,
            indicators: [],
            priceRange: { min: 0, max: 1 },
            autoScale: true,
            visible: true
        };
        canvas.onResize = (w, h) => {
            pane.width = w;
            pane.innerHeight = h;
        };
        return pane;
    }

    /**
     * Add a new indicator pane below the existing ones.
     */
    addPane(id, title, height = 120) {
        // Check if exists
        const existing = this.panes.find(p => p.id === id);
        if (existing) return existing;
        const pane = this._createPane(id, title, height, false);
        this.panes.push(pane);
        // FIX: Move the newly-created pane wrapper to sit BEFORE the time axis
        // pane so the time axis strip always remains at the very bottom of the
        // chart (below all indicator panes). _createPane appends to the end of
        // the container, which would otherwise place it after the time axis.
        if (this.timeAxisPane && this.timeAxisPane.wrapper.parentNode === this.container) {
            this.container.insertBefore(pane.wrapper, this.timeAxisPane.wrapper);
        }
        // Insert resize handle before this pane (now correctly between the
        // previous pane and this one, before the time axis).
        this._insertResizeHandle(pane);
        this._layout();
        return pane;
    }

    _insertResizeHandle(pane) {
        const handle = DomUtils.el('div', { class: 'ac-pane-resize-handle' });
        pane.wrapper.parentNode.insertBefore(handle, pane.wrapper);
        let startY = 0, startH = 0, prevPane = null, startPrevH = 0;
        const onMove = (e) => {
            const dy = e.clientY - startY;
            const newH = Math.max(60, startH - dy);
            const newPrevH = Math.max(80, startPrevH + dy);
            pane.height = newH;
            if (prevPane) prevPane.height = newPrevH;
            this._layout();
        };
        const onUp = () => {
            document.removeEventListener('pointermove', onMove);
            document.removeEventListener('pointerup', onUp);
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
        };
        handle.addEventListener('pointerdown', (e) => {
            e.preventDefault();
            startY = e.clientY;
            startH = pane.height;
            const idx = this.panes.indexOf(pane);
            prevPane = idx > 0 ? this.panes[idx - 1] : null;
            startPrevH = prevPane ? prevPane.height : 0;
            document.addEventListener('pointermove', onMove);
            document.addEventListener('pointerup', onUp);
            document.body.style.cursor = 'ns-resize';
            document.body.style.userSelect = 'none';
        });
    }

    removePane(id) {
        const idx = this.panes.findIndex(p => p.id === id);
        if (idx <= 0) return; // can't remove main
        const pane = this.panes[idx];
        // Remove preceding resize handle
        const handle = pane.wrapper.previousElementSibling;
        if (handle && handle.classList.contains('ac-pane-resize-handle')) handle.remove();
        pane.wrapper.remove();
        pane.canvas.destroy();
        this.panes.splice(idx, 1);
        this._layout();
    }

    getPane(id) {
        return this.panes.find(p => p.id === id);
    }

    get main() { return this.panes[0]; }

    /**
     * Apply heights to DOM. Each pane uses flex-basis for its height.
     * The time axis pane has a fixed height and is always at the bottom.
     */
    _layout() {
        const totalH = this.container.clientHeight;
        const handleCount = this.panes.length - 1;
        const handleH = 4; // px per handle
        const timeAxisH = this.timeAxisPane ? this.timeAxisPane.height : 0;
        let usedH = handleCount * handleH + timeAxisH;
        for (const p of this.panes) usedH += p.height;
        // If overflow, scale down the resizable panes proportionally (keep time axis fixed)
        if (usedH > totalH) {
            const available = totalH - handleCount * handleH - timeAxisH;
            let paneH = 0;
            for (const p of this.panes) paneH += p.height;
            const scale = available / paneH;
            for (const p of this.panes) p.height *= scale;
        }
        for (const p of this.panes) {
            p.wrapper.style.flexBasis = p.height + 'px';
            p.wrapper.style.flexGrow = p.isMain ? '1' : '0';
        }
        if (this.timeAxisPane) {
            this.timeAxisPane.wrapper.style.flexBasis = timeAxisH + 'px';
            this.timeAxisPane.wrapper.style.flexGrow = '0';
        }
    }

    /**
     * Get the pane under a Y coordinate (relative to the container).
     */
    paneAtY(y) {
        let acc = 0;
        for (const p of this.panes) {
            acc += p.height + 4;
            if (y <= acc) return p;
        }
        return this.panes[this.panes.length - 1];
    }

    destroy() {
        this._resizeObserver.disconnect();
        for (const p of this.panes) p.canvas.destroy();
    }
}
