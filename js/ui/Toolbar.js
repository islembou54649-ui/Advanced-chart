/**
 * Toolbar.js
 * Top toolbar with drawing tools, zoom controls, theme toggle, etc.
 * Built as plain DOM for maximum performance and zero CSS framework dependencies.
 */
import { DomUtils } from '../utils/DomUtils.js';

const TOOLS = [
    { id: 'cursor',   icon: '↖', label: 'Cursor (V)',         key: 'v' },
    { id: 'crosshair',icon: '✛', label: 'Crosshair',           key: 'c' },
    { id: 'trendline',icon: '╱', label: 'Trend Line (T)',      key: 't' },
    { id: 'hline',    icon: '─', label: 'Horizontal Line (H)', key: 'h' },
    { id: 'rectangle',icon: '▭', label: 'Rectangle (R)',       key: 'r' },
    { id: 'fib',      icon: 'F', label: 'Fibonacci (F)',       key: 'f' },
    { id: 'text',     icon: 'T', label: 'Text (X)',            key: 'x' }
];

export class Toolbar {
    constructor(container, engine) {
        this.container = container;
        this.engine = engine;
        this.element = DomUtils.el('div', { class: 'ac-toolbar' });
        container.appendChild(this.element);
        this._buttons = new Map();
        this._build();
    }

    _build() {
        // Left group: brand + symbol
        const brand = DomUtils.el('div', { class: 'ac-toolbar-brand' }, [
            DomUtils.el('span', { class: 'ac-brand-mark' }, 'AC'),
            DomUtils.el('span', { class: 'ac-brand-name' }, 'Advanced Chart')
        ]);
        // NOTE: the select is populated by the clean loop below. Constructing it
        // with a nested-array children arg crashes DomUtils.el (appendChild receives
        // an Array, not a Node), so we create it empty here.
        const symbolSel = DomUtils.el('select', { class: 'ac-symbol-select' });
        // Build symbol options cleanly
        const symbols = [
            ['BTCUSDT', 'BTC / USDT'],
            ['ETHUSDT', 'ETH / USDT'],
            ['BNBUSDT', 'BNB / USDT'],
            ['SOLUSDT', 'SOL / USDT']
        ];
        symbolSel.innerHTML = '';
        for (const [val, txt] of symbols) {
            symbolSel.appendChild(DomUtils.el('option', { value: val }, txt));
        }

        // Tools group
        const toolsGroup = DomUtils.el('div', { class: 'ac-toolbar-group' });
        for (const t of TOOLS) {
            const btn = DomUtils.el('button', {
                class: 'ac-toolbar-btn',
                dataset: { tool: t.id },
                title: t.label
            }, t.icon);
            btn.addEventListener('click', () => this._selectTool(t.id));
            toolsGroup.appendChild(btn);
            this._buttons.set(t.id, btn);
        }

        // Interval group
        const intervalGroup = DomUtils.el('div', { class: 'ac-toolbar-group' });
        const intervals = ['1m', '5m', '15m', '1h', '4h', '1D', '1W'];
        for (const iv of intervals) {
            const btn = DomUtils.el('button', {
                class: 'ac-toolbar-btn ac-toolbar-btn-sm',
                dataset: { interval: iv }
            }, iv);
            btn.addEventListener('click', () => this._setInterval(iv));
            intervalGroup.appendChild(btn);
        }

        // Right group: zoom, fit, theme
        const rightGroup = DomUtils.el('div', { class: 'ac-toolbar-group ac-toolbar-right' });
        const zoomIn = DomUtils.el('button', { class: 'ac-toolbar-btn', title: 'Zoom In' }, '+');
        const zoomOut = DomUtils.el('button', { class: 'ac-toolbar-btn', title: 'Zoom Out' }, '−');
        const fitBtn = DomUtils.el('button', { class: 'ac-toolbar-btn', title: 'Fit All' }, '⤢');
        const clearBtn = DomUtils.el('button', { class: 'ac-toolbar-btn', title: 'Clear Drawings' }, '✕');
        const themeBtn = DomUtils.el('button', { class: 'ac-toolbar-btn', title: 'Toggle Theme', id: 'ac-theme-btn' }, '◐');
        const liveBtn = DomUtils.el('button', { class: 'ac-toolbar-btn ac-toolbar-btn-toggle', title: 'Toggle Live Feed', id: 'ac-live-btn' }, '● Live');
        zoomIn.addEventListener('click', () => this.engine.zoomBy(1.25));
        zoomOut.addEventListener('click', () => this.engine.zoomBy(0.8));
        fitBtn.addEventListener('click', () => this.engine.fitAll());
        clearBtn.addEventListener('click', () => { if (confirm('Clear all drawings?')) this.engine.drawingManager.clear(); this.engine.requestRender(); });
        themeBtn.addEventListener('click', () => this.engine.toggleTheme());
        liveBtn.addEventListener('click', () => this.engine.toggleLive());
        rightGroup.append(zoomIn, zoomOut, fitBtn, clearBtn, themeBtn, liveBtn);

        this.element.append(brand, symbolSel, toolsGroup, intervalGroup, rightGroup);

        // Default selection: highlight the cursor button only. Do NOT call
        // engine.setActiveTool here — the engine is still constructing
        // (engine.toolbar / engine.loop are not assigned yet), and engine.activeTool
        // already defaults to null (cursor mode). Calling back now would crash.
        this._buttons.get('cursor')?.classList.add('active');
    }

    _selectTool(toolId) {
        // Map 'cursor' and 'crosshair' to no-tool mode
        const drawingTool = (toolId === 'cursor' || toolId === 'crosshair') ? null : toolId;
        this.engine.setActiveTool(drawingTool);
        for (const [id, btn] of this._buttons) {
            btn.classList.toggle('active', id === toolId);
        }
    }

    _setInterval(iv) {
        this.engine.setInterval(iv);
        document.querySelectorAll('[data-interval]').forEach(b => b.classList.remove('active'));
        document.querySelector(`[data-interval="${iv}"]`)?.classList.add('active');
    }

    /**
     * Called by the engine to sync the toolbar highlight to the active tool.
     * IMPORTANT: only update the UI here. Do NOT call engine.setActiveTool —
     * _selectTool already does that, so re-entering it from here would recurse:
     * engine.setActiveTool -> toolbar.setActiveTool -> _selectTool -> engine.setActiveTool ...
     */
    setActiveTool(tool) {
        const toolId = tool || 'cursor';
        for (const [id, btn] of this._buttons) {
            btn.classList.toggle('active', id === toolId);
        }
    }
}
