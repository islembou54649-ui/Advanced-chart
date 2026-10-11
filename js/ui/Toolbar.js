/**
 * Toolbar.js
 * Top toolbar with:
 *  - Brand + symbol selector
 *  - Drawing tools (categorized dropdown menu)
 *  - Indicators (categorized dropdown menu)
 *  - Intervals
 *  - Zoom/fit/clear/theme/live actions
 *
 * For 100+ tools/indicators, we use dropdown menus organized by category.
 */
import { DomUtils } from '../utils/DomUtils.js';
import { INDICATOR_REGISTRY } from '../indicators/IndicatorManager.js';
import { CHART_TYPES } from '../series/ChartTypeManager.js';

const TOOL_CATEGORIES = [
    {
        name: 'Trend & Lines',
        tools: [
            { id: 'trendline', label: 'Trend Line', icon: '╱' },
            { id: 'ray',       label: 'Ray',         icon: '→' },
            { id: 'hline',     label: 'Horizontal Line', icon: '─' },
            { id: 'vline',     label: 'Vertical Line',   icon: '│' },
            { id: 'arrow',     label: 'Arrow',       icon: '➤' },
            { id: 'brush',     label: 'Brush',       icon: '๛' },
            { id: 'polyline',  label: 'Polyline',    icon: '⩘' }
        ]
    },
    {
        name: 'Shapes',
        tools: [
            { id: 'rectangle', label: 'Rectangle', icon: '▭' },
            { id: 'ellipse',   label: 'Ellipse',   icon: '◯' },
            { id: 'triangle',  label: 'Triangle',  icon: '△' }
        ]
    },
    {
        name: 'Fibonacci',
        tools: [
            { id: 'fib',        label: 'Fib Retracement', icon: 'F' },
            { id: 'fibext',     label: 'Fib Extension',   icon: 'F+' },
            { id: 'fibchannel', label: 'Fib Channel',     icon: 'F‖' }
        ]
    },
    {
        name: 'Patterns & Channels',
        tools: [
            { id: 'channel',  label: 'Parallel Channel', icon: '‖' },
            { id: 'pitchfork', label: 'Andrews Pitchfork', icon: '⋔' },
            { id: 'gannbox',  label: 'Gann Box',          icon: '⊞' }
        ]
    },
    {
        name: 'Positions',
        tools: [
            { id: 'longpos',  label: 'Long Position',  icon: '↗' },
            { id: 'shortpos', label: 'Short Position', icon: '↘' }
        ]
    },
    {
        name: 'Annotations',
        tools: [
            { id: 'text',       label: 'Text',        icon: 'T' },
            { id: 'pricelabel', label: 'Price Label', icon: '⌖' },
            { id: 'daterange',  label: 'Date Range',  icon: '▤' },
            { id: 'measurement', label: 'Measurement', icon: '↔' }
        ]
    }
];

export class Toolbar {
    constructor(container, engine) {
        this.container = container;
        this.engine = engine;
        this.element = DomUtils.el('div', { class: 'ac-toolbar' });
        container.appendChild(this.element);
        this._buttons = new Map();
        this._openMenu = null;
        this._build();
        // Close menus on outside click
        document.addEventListener('pointerdown', (e) => {
            if (!e.target.closest('.ac-toolbar-menu-trigger') && !e.target.closest('.ac-toolbar-menu')) {
                this._closeMenus();
            }
        });
    }

    _build() {
        // Brand
        const brand = DomUtils.el('div', { class: 'ac-toolbar-brand' }, [
            DomUtils.el('span', { class: 'ac-brand-mark' }, 'AC'),
            DomUtils.el('span', { class: 'ac-brand-name' }, 'Advanced Chart')
        ]);

        // Symbol select
        const symbolSel = DomUtils.el('select', { class: 'ac-symbol-select' });
        for (const [val, txt] of [['BTCUSDT', 'BTC / USDT'], ['ETHUSDT', 'ETH / USDT'], ['BNBUSDT', 'BNB / USDT'], ['SOLUSDT', 'SOL / USDT']]) {
            symbolSel.appendChild(DomUtils.el('option', { value: val }, txt));
        }

        // Cursor button (default)
        const cursorBtn = DomUtils.el('button', { class: 'ac-toolbar-btn active', title: 'Cursor (V)', dataset: { tool: 'cursor' } }, '↖');
        cursorBtn.addEventListener('click', () => this._selectTool('cursor'));
        this._buttons.set('cursor', cursorBtn);

        // Drawings dropdown trigger
        const drawTrigger = DomUtils.el('button', { class: 'ac-toolbar-btn ac-toolbar-menu-trigger', title: 'Drawing Tools' }, [
            DomUtils.el('span', {}, 'Tools'),
            DomUtils.el('span', { class: 'ac-caret' }, '▾')
        ]);
        drawTrigger.addEventListener('click', (e) => this._toggleMenu('draw', drawTrigger));

        // Indicators dropdown trigger
        const indTrigger = DomUtils.el('button', { class: 'ac-toolbar-btn ac-toolbar-menu-trigger', title: 'Indicators' }, [
            DomUtils.el('span', {}, 'Indicators'),
            DomUtils.el('span', { class: 'ac-caret' }, '▾')
        ]);
        indTrigger.addEventListener('click', (e) => this._toggleMenu('ind', indTrigger));

        // Chart type dropdown trigger
        const chartTypeTrigger = DomUtils.el('button', { class: 'ac-toolbar-btn ac-toolbar-menu-trigger', title: 'Chart Type' }, [
            DomUtils.el('span', {}, 'Chart Type'),
            DomUtils.el('span', { class: 'ac-caret' }, '▾')
        ]);
        chartTypeTrigger.addEventListener('click', (e) => this._toggleMenu('charttype', chartTypeTrigger));

        // Interval group
        const intervalGroup = DomUtils.el('div', { class: 'ac-toolbar-group' });
        for (const iv of ['1m', '5m', '15m', '1h', '4h', '1D', '1W']) {
            const btn = DomUtils.el('button', {
                class: 'ac-toolbar-btn ac-toolbar-btn-sm' + (iv === '1m' ? ' active' : ''),
                dataset: { interval: iv }
            }, iv);
            btn.addEventListener('click', () => this._setInterval(iv));
            intervalGroup.appendChild(btn);
        }

        // Right actions
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
        clearBtn.addEventListener('click', () => {
            if (confirm('Clear all drawings?')) this.engine.drawingManager.clear();
            this.engine.requestRender();
        });
        themeBtn.addEventListener('click', () => this.engine.toggleTheme());
        liveBtn.addEventListener('click', () => this.engine.toggleLive());
        rightGroup.append(zoomIn, zoomOut, fitBtn, clearBtn, themeBtn, liveBtn);

        this.element.append(brand, symbolSel, cursorBtn, drawTrigger, indTrigger, chartTypeTrigger, intervalGroup, rightGroup);
    }

    _toggleMenu(name, trigger) {
        this._closeMenus();
        if (this._openMenu === name) { this._openMenu = null; return; }
        const menu = DomUtils.el('div', { class: 'ac-toolbar-menu' });
        if (name === 'draw') this._buildDrawMenu(menu);
        else if (name === 'ind') this._buildIndicatorMenu(menu);
        else if (name === 'charttype') this._buildChartTypeMenu(menu);
        document.body.appendChild(menu);
        // Position below trigger
        const r = trigger.getBoundingClientRect();
        menu.style.left = r.left + 'px';
        menu.style.top = (r.bottom + 2) + 'px';
        this._openMenu = name;
        this._currentMenu = menu;
    }

    _closeMenus() {
        if (this._currentMenu) { this._currentMenu.remove(); this._currentMenu = null; }
        this._openMenu = null;
    }

    _buildDrawMenu(menu) {
        for (const cat of TOOL_CATEGORIES) {
            const catEl = DomUtils.el('div', { class: 'ac-menu-category' }, cat.name);
            menu.appendChild(catEl);
            for (const t of cat.tools) {
                const item = DomUtils.el('button', { class: 'ac-menu-item', dataset: { tool: t.id } }, [
                    DomUtils.el('span', { class: 'ac-menu-icon' }, t.icon),
                    DomUtils.el('span', {}, t.label)
                ]);
                item.addEventListener('click', () => {
                    this._selectTool(t.id);
                    this._closeMenus();
                });
                menu.appendChild(item);
            }
        }
    }

    _buildIndicatorMenu(menu) {
        // Group by category
        const cats = {};
        for (const [key, reg] of Object.entries(INDICATOR_REGISTRY)) {
            if (!cats[reg.category]) cats[reg.category] = [];
            cats[reg.category].push({ key, ...reg });
        }
        for (const [catName, items] of Object.entries(cats)) {
            const catEl = DomUtils.el('div', { class: 'ac-menu-category' }, catName);
            menu.appendChild(catEl);
            for (const it of items) {
                const item = DomUtils.el('button', { class: 'ac-menu-item', dataset: { indicator: it.key } }, [
                    DomUtils.el('span', { class: 'ac-menu-icon' }, it.type === 'overlay' ? '◯' : '▤'),
                    DomUtils.el('span', {}, it.key)
                ]);
                item.addEventListener('click', () => {
                    this.engine.addIndicator(it.key, {});
                    this._closeMenus();
                });
                menu.appendChild(item);
            }
        }
    }

    _buildChartTypeMenu(menu) {
        // Group by category
        const cats = {};
        for (const ct of CHART_TYPES) {
            if (!cats[ct.category]) cats[ct.category] = [];
            cats[ct.category].push(ct);
        }
        const current = this.engine.getChartType();
        for (const [catName, items] of Object.entries(cats)) {
            const catEl = DomUtils.el('div', { class: 'ac-menu-category' }, catName);
            menu.appendChild(catEl);
            for (const ct of items) {
                const isCurrent = ct.id === current;
                const item = DomUtils.el('button', { class: 'ac-menu-item' + (isCurrent ? ' active' : ''), dataset: { chartType: ct.id } }, [
                    DomUtils.el('span', { class: 'ac-menu-icon' }, isCurrent ? '●' : '○'),
                    DomUtils.el('span', {}, ct.label)
                ]);
                item.addEventListener('click', () => {
                    this.engine.setChartType(ct.id);
                    this._closeMenus();
                });
                menu.appendChild(item);
            }
        }
    }

    _selectTool(toolId) {
        const drawingTool = (toolId === 'cursor' || toolId === 'crosshair') ? null : toolId;
        this.engine.setActiveTool(drawingTool);
        for (const [id, btn] of this._buttons) btn.classList.toggle('active', id === toolId);
    }

    _setInterval(iv) {
        this.engine.setInterval(iv);
        document.querySelectorAll('[data-interval]').forEach(b => b.classList.remove('active'));
        document.querySelector(`[data-interval="${iv}"]`)?.classList.add('active');
    }

    setActiveTool(tool) {
        const toolId = tool || 'cursor';
        for (const [id, btn] of this._buttons) btn.classList.toggle('active', id === toolId);
    }
}
