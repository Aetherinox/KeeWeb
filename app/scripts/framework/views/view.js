import morphdom from 'morphdom';
import EventEmitter from 'events';
import { Tip } from 'util/ui/tip';
import { KeyHandler } from 'comp/browser/key-handler';
import { Logger } from 'util/logger';

const DoesNotBubble = {
    mouseenter: true,
    mouseleave: true,
    blur: true,
    focus: true
};

class View extends EventEmitter {
    parent = undefined;
    template = undefined;
    events = {};
    model = undefined;
    options = {};
    views = {};
    hidden = false;
    removed = false;
    modal = undefined;
    eventListeners = {};
    elementEventListeners = [];
    debugLogger = localStorage.debugView ? new Logger('view', this.constructor.name) : undefined;

    constructor(model = undefined, options = {}) {
        super();

        this.model = model;
        this.options = options;

        this.setMaxListeners(100);
    }

    render(templateData) {
        if (this.removed) {
            return;
        }

        let ts;
        if (this.debugLogger) {
            this.debugLogger.debug('Render start');
            ts = this.debugLogger.ts();
        }

        if (this.el) {
            Tip.destroyTips(this.el);
        }

        this.renderElement(templateData);

        Tip.createTips(this.el);

        this.debugLogger && this.debugLogger.debug('Render finished', this.debugLogger.ts(ts));

        return this;
    }

    renderElement(templateData) {
        const html = this.template(templateData);
        if (this.el) {
            const mountRoot = this.options.ownParent ? this.el.firstChild : this.el;
            morphdom(mountRoot, html);
            this.bindElementEvents();
        } else {
            let parent = this.options.parent || this.parent;
            if (parent) {
                if (typeof parent === 'string') {
                    parent = document.querySelector(parent);
                }
                if (!parent) {
                    throw new Error(`Error rendering ${this.constructor.name}: parent not found`);
                }
                if (this.options.replace) {
                    Tip.destroyTips(parent);
                    parent.innerHTML = '';
                }
                const el = document.createElement('div');
                el.innerHTML = html;
                const root = el.firstChild;
                if (this.options.ownParent) {
                    if (root) {
                        parent.appendChild(root);
                    }
                    this.el = parent;
                } else {
                    this.el = root;
                    parent.appendChild(this.el);
                }
                if (this.modal) {
                    KeyHandler.setModal(this.modal);
                }
                this.bindEvents();
            } else {
                throw new Error(
                    `Error rendering ${this.constructor.name}: I don't know how to insert the view`
                );
            }
            this.$el = $(this.el); // legacy
        }
    }

    bindEvents() {
        const eventsMap = {};
        for (const [eventDef, method] of Object.entries(this.events)) {
            const spaceIx = eventDef.indexOf(' ');
            let event, selector;
            if (spaceIx > 0) {
                event = eventDef.substr(0, spaceIx);
                selector = eventDef.substr(spaceIx + 1);
                if (DoesNotBubble[event]) {
                    this.elementEventListeners.push({ event, selector, method, els: [] });
                    continue;
                }
            } else {
                event = eventDef;
            }
            if (!eventsMap[event]) {
                eventsMap[event] = [];
            }
            eventsMap[event].push({ selector, method });
        }
        for (const [event, handlers] of Object.entries(eventsMap)) {
            this.debugLogger && this.debugLogger.debug('Bind', 'view', event, handlers);
            const listener = e => this.eventListener(e, handlers);
            this.eventListeners[event] = listener;
            this.el.addEventListener(event, listener);
        }
        this.bindElementEvents();
    }

    unbindEvents() {
        for (const [event, listener] of Object.entries(this.eventListeners)) {
            this.el.removeEventListener(event, listener);
        }
        this.unbindElementEvents();
    }

    bindElementEvents() {
        if (!this.elementEventListeners.length) {
            return;
        }
        this.unbindElementEvents();
        for (const cfg of this.elementEventListeners) {
            const els = this.el.querySelectorAll(cfg.selector);
            this.debugLogger &&
                this.debugLogger.debug('Bind', 'element', cfg.event, cfg.selector, els.length);
            cfg.listener = e => this.eventListener(e, [cfg]);
            for (const el of els) {
                el.addEventListener(cfg.event, cfg.listener);
                cfg.els.push(el);
            }
        }
    }

    unbindElementEvents() {
        if (!this.elementEventListeners.length) {
            return;
        }
        for (const cfg of this.elementEventListeners) {
            for (const el of cfg.els) {
                el.removeEventListener(cfg.event, cfg.listener);
            }
            cfg.els = [];
        }
    }

    eventListener(e, handlers) {
        this.debugLogger && this.debugLogger.debug('Listener fired', e.type);
        for (const { selector, method } of handlers) {
            if (selector) {
                const closest = e.target.closest(selector);
                if (!closest || !this.el.contains(closest)) {
                    continue;
                }
            }
            if (!this[method]) {
                this.debugLogger && this.debugLogger.debug('Method not defined', method);
                continue;
            }
            this.debugLogger && this.debugLogger.debug('Handling event', e.type, method);
            this[method](e);
        }
    }

    remove() {
        if (this.modal && KeyHandler.modal === this.modal) {
            KeyHandler.setModal(null);
        }
        this.emit('remove');

        this.removeInnerViews();
        Tip.hideTips(this.el);
        this.el.remove();
        this.removed = true;

        this.debugLogger && this.debugLogger.debug('Remove');
    }

    removeInnerViews() {
        if (this.views) {
            for (const view of Object.values(this.views)) {
                if (view) {
                    if (view instanceof Array) {
                        view.forEach(v => v.remove());
                    } else {
                        view.remove();
                    }
                }
            }
            this.views = {};
        }
    }

    listenTo(model, event, callback) {
        const boundCallback = callback.bind(this);
        model.on(event, boundCallback);
        this.once('remove', () => model.off(event, boundCallback));
    }

    hide() {
        Tip.hideTips(this.el);
        return this.toggle(false);
    }

    show() {
        return this.toggle(true);
    }

    toggle(visible) {
        this.debugLogger && this.debugLogger.debug(visible ? 'Show' : 'Hide');
        if (visible === undefined) {
            visible = this.hidden;
        }
        this.hidden = !visible;
        if (this.modal) {
            if (visible) {
                KeyHandler.setModal(this.modal);
            } else if (KeyHandler.modal === this.modal) {
                KeyHandler.setModal(null);
            }
        }
        this.emit(visible ? 'show' : 'hide');
        if (this.el) {
            this.el.classList.toggle('show', !!visible);
            this.el.classList.toggle('hide', !visible);
            if (!visible) {
                Tip.hideTips(this.el);
            }
        }
    }

    isHidden() {
        return this.hidden;
    }

    isVisible() {
        return !this.hidden;
    }

    afterPaint(callback) {
        requestAnimationFrame(() => requestAnimationFrame(callback));
    }

    onKey(key, handler, shortcut, modal, noPrevent) {
        KeyHandler.onKey(key, handler, this, shortcut, modal, noPrevent);
        this.once('remove', () => KeyHandler.offKey(key, handler, this));
    }

    off(event, listener) {
        if (listener === undefined) {
            return super.removeAllListeners(event);
        } else {
            return super.off(event, listener);
        }
    }
}

export { View };