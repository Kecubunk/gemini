const Me = imports.misc.extensionUtils.getCurrentExtension();
const Config = Me.imports.config;
const Forest = Me.imports.forest;
const Ecs = Me.imports.ecs;
const Events = Me.imports.events;
const Focus = Me.imports.focus;
const GrabOp = Me.imports.grab_op;
const Keybindings = Me.imports.keybindings;
const Lib = Me.imports.lib;
const log = Me.imports.log;
const PanelSettings = Me.imports.panel_settings;
const Rect = Me.imports.rectangle;
const Settings = Me.imports.settings;
const Tiling = Me.imports.tiling;
const Window = Me.imports.window;
const launcher = Me.imports.dialog_launcher;
const auto_tiler = Me.imports.auto_tiler;
const node = Me.imports.node;
const utils = Me.imports.utils;
const Executor = Me.imports.executor;
const movement = Me.imports.movement;
const stack = Me.imports.stack;
const add_exception = Me.imports.dialog_add_exception;
const exec = Me.imports.executor;
const display = global.display;
const wim = global.window_manager;
const wom = global.workspace_manager;
const Movement = movement.Movement;
const GLib = imports.gi.GLib;
const { Gio, Meta, St } = imports.gi;
const { GlobalEvent, WindowEvent } = Events;
const { cursor_rect, is_move_op } = Lib;
const { layoutManager, loadTheme, overview, panel, setThemeStylesheet, screenShield, sessionMode } = imports.ui.main;
const Tags = Me.imports.tags;
const STYLESHEET_PATHS = ['light', 'dark'].map(stylesheet_path);
const STYLESHEETS = STYLESHEET_PATHS.map((path) => Gio.File.new_for_path(path));
const GNOME_VERSION = utils.gnome_version();
var Style;
(function (Style) {
    Style[Style["Light"] = 0] = "Light";
    Style[Style["Dark"] = 1] = "Dark";
})(Style || (Style = {}));
var Ext = class Ext extends Ecs.System {
    constructor() {
        super(new Executor.GLibExecutor());
        this.keybindings = new Keybindings.Keybindings(this);
        this.settings = new Settings.ExtensionSettings();
        this.overlay = new St.BoxLayout({ style_class: "pop-shell-overlay", visible: false });
        this.window_search = new launcher.Launcher(this);
        this.animate_windows = true;
        this.button = null;
        this.button_gio_icon_auto_on = null;
        this.button_gio_icon_auto_off = null;
        this.conf = new Config.Config();
        this.conf_watch = null;
        this.column_size = 32;
        this.current_style = this.settings.is_dark_shell() ? Style.Dark : Style.Light;
        this.displays_updating = null;
        this.row_size = 32;
        this.displays = [global.display.get_primary_monitor(), new Map()];
        this.dpi = St.ThemeContext.get_for_stage(global.stage).scale_factor;
        this.exception_selecting = false;
        this.gap_inner = 0;
        this.gap_inner_half = 0;
        this.gap_inner_prev = 0;
        this.gap_outer = 0;
        this.gap_outer_prev = 0;
        this.grab_op = null;
        this.ignore_display_update = false;
        this.last_focused = null;
        this.prev_focused = null;
        this.tween_signals = new Map();
        this.tiling_toggle_switch = null;
        this.init = true;
        this.was_locked = false;
        this.workareas_update = null;
        this.signals = new Map();
        this.size_requests = new Map();
        this.focus_trigger = null;
        this.ids = this.register_storage();
        this.monitors = this.register_storage();
        this.movements = this.register_storage();
        this.names = this.register_storage();
        this.size_changed_signal = 0;
        this.size_signals = this.register_storage();
        this.snapped = this.register_storage();
        this.windows = this.register_storage();
        this.window_signals = this.register_storage();
        this.auto_tiler = null;
        this.focus_selector = new Focus.FocusSelector();
        this.tiler = new Tiling.Tiler(this);
        this.load_settings();
        this.register_fn(() => load_theme(this.current_style));
        this.conf.reload();
        if (this.settings.int) {
            this.settings.int.connect('changed::gtk-theme', () => {
                this.register(Events.global(GlobalEvent.GtkThemeChanged));
            });
        }
        if (this.settings.shell) {
            this.settings.shell.connect('changed::name', () => {
                this.register(Events.global(GlobalEvent.GtkShellChanged));
            });
        }
    }
    register_fn(callback, name) {
        this.register({ tag: 1, callback, name });
    }
    run(event) {
        var _a;
        switch (event.tag) {
            case 1:
                (event.callback)();
                break;
            case 2:
                let win = event.window;
                if (!win.actor_exists())
                    return;
                if (event.kind.tag === 1) {
                    const { window } = event;
                    let movement = this.movements.remove(window.entity);
                    if (!movement)
                        return;
                    let actor = window.meta.get_compositor_private();
                    if (!actor) {
                        (_a = this.auto_tiler) === null || _a === void 0 ? void 0 : _a.detach_window(this, window.entity);
                        return;
                    }
                    actor.remove_all_transitions();
                    const { x, y, width, height } = movement;
                    window.meta.move_resize_frame(true, x, y, width, height);
                    window.meta.move_frame(true, x, y);
                    this.monitors.insert(window.entity, [
                        win.meta.get_monitor(),
                        win.workspace_id()
                    ]);
                    if (win.activate_after_move) {
                        win.activate_after_move = false;
                        win.activate();
                    }
                    return;
                }
                switch (event.kind.event) {
                    case WindowEvent.Maximize:
                        this.on_maximize(win);
                        break;
                    case WindowEvent.Minimize:
                        this.on_minimize(win);
                        break;
                    case WindowEvent.Size:
                        if (this.auto_tiler && !win.is_maximized() && !win.meta.is_fullscreen()) {
                            this.auto_tiler.reflow(this, win.entity);
                        }
                        break;
                    case WindowEvent.Workspace:
                        this.on_workspace_changed(win);
                        break;
                    case WindowEvent.Fullscreen:
                        if (this.auto_tiler) {
                            let attachment = this.auto_tiler.attached.get(win.entity);
                            if (attachment) {
                                if (!win.meta.is_fullscreen()) {
                                    let fork = this.auto_tiler.forest.forks.get(win.entity);
                                    if (fork) {
                                        this.auto_tiler.reflow(this, win.entity);
                                    }
                                    if (win.stack !== null) {
                                        let stack = this.auto_tiler.forest.stacks.get(win.stack);
                                        if (stack) {
                                            stack.set_visible(true);
                                        }
                                    }
                                }
                                else {
                                    if (win.stack !== null) {
                                        let stack = this.auto_tiler.forest.stacks.get(win.stack);
                                        if (stack) {
                                            stack.set_visible(false);
                                        }
                                    }
                                }
                                if (win.is_maximized()) {
                                    this.size_changed_block();
                                    win.meta.unmaximize(Meta.MaximizeFlags.BOTH);
                                    win.meta.make_fullscreen();
                                    this.size_changed_unblock();
                                }
                            }
                        }
                        break;
                }
                break;
            case 3:
                let actor = event.window.get_compositor_private();
                if (!actor)
                    return;
                this.on_window_create(event.window, actor);
                break;
            case 4:
                switch (event.event) {
                    case GlobalEvent.GtkShellChanged:
                        this.on_gtk_shell_changed();
                        break;
                    case GlobalEvent.GtkThemeChanged:
                        this.on_gtk_theme_change();
                        break;
                    case GlobalEvent.MonitorsChanged:
                        this.update_display_configuration(false);
                        break;
                    case GlobalEvent.OverviewShown:
                        this.on_overview_shown();
                        break;
                    case GlobalEvent.OverviewHidden:
                        this.on_overview_hidden();
                        break;
                }
                break;
        }
    }
    activate_window(window) {
        if (window) {
            window.activate();
        }
    }
    active_monitor() {
        return display.get_current_monitor();
    }
    active_window_list() {
        let workspace = wom.get_active_workspace();
        return this.tab_list(Meta.TabList.NORMAL, workspace);
    }
    active_workspace() {
        return wom.get_active_workspace_index();
    }
    actor_of(entity) {
        const window = this.windows.get(entity);
        return window ? window.meta.get_compositor_private() : null;
    }
    attach_config() {
        const monitor = this.conf_watch = Gio.File.new_for_path(Config.CONF_FILE)
            .monitor(Gio.FileMonitorFlags.NONE, null);
        return [monitor, monitor.connect('changed', () => {
                this.conf.reload();
                if (this.auto_tiler) {
                    const at = this.auto_tiler;
                    for (const [entity, window] of this.windows.iter()) {
                        const attachment = at.attached.get(entity);
                        if (window.is_tilable(this)) {
                            if (!attachment) {
                                at.auto_tile(this, window, this.init);
                            }
                        }
                        else if (attachment) {
                            at.detach_window(this, entity);
                        }
                    }
                }
            })];
    }
    connect(object, property, callback) {
        const signal = object.connect(property, callback);
        const entry = this.signals.get(object);
        if (entry) {
            entry.push(signal);
        }
        else {
            this.signals.set(object, [signal]);
        }
        return signal;
    }
    connect_meta(win, signal, callback) {
        const id = win.meta.connect(signal, () => {
            if (win.actor_exists())
                callback();
        });
        this.window_signals.get_or(win.entity, () => new Array()).push(id);
        return id;
    }
    connect_size_signal(win, signal, func) {
        return this.connect_meta(win, signal, () => {
            if (!this.contains_tag(win.entity, Tags.Blocked))
                func();
        });
    }
    connect_window(win) {
        const size_event = () => {
            const old = this.size_requests.get(win.meta);
            if (old) {
                try {
                    GLib.source_remove(old);
                }
                catch (_) { }
            }
            const new_s = GLib.timeout_add(GLib.PRIORITY_LOW, 500, () => {
                this.register(Events.window_event(win, WindowEvent.Size));
                this.size_requests.delete(win.meta);
                return false;
            });
            this.size_requests.set(win.meta, new_s);
        };
        this.connect_meta(win, 'workspace-changed', () => {
            this.register(Events.window_event(win, WindowEvent.Workspace));
        });
        this.size_signals.insert(win.entity, [
            this.connect_size_signal(win, 'size-changed', size_event),
            this.connect_size_signal(win, 'position-changed', size_event),
            this.connect_size_signal(win, 'notify::minimized', () => {
                this.register(Events.window_event(win, WindowEvent.Minimize));
            }),
        ]);
    }
    exception_add(win) {
        this.exception_selecting = false;
        let d = new add_exception.AddExceptionDialog(() => this.exception_dialog(), () => {
            let wmclass = win.meta.get_wm_class();
            if (wmclass)
                this.conf.add_app_exception(wmclass);
            this.exception_dialog();
        }, () => {
            let wmclass = win.meta.get_wm_class();
            if (wmclass)
                this.conf.add_window_exception(wmclass, win.meta.get_title());
            this.exception_dialog();
        });
        d.open();
    }
    exception_dialog() {
        let path = Me.dir.get_path() + "/floating_exceptions/main.js";
        utils.async_process(["gjs", path], null, null)
            .then(output => {
            log.debug(`Floating Window Dialog Event: ${output}`);
            switch (output.trim()) {
                case "SELECT":
                    this.register_fn(() => this.exception_select());
            }
        })
            .catch(error => {
            log.error(`floating window process error: ${error}`);
        });
    }
    exception_select() {
        if (GNOME_VERSION === null || GNOME_VERSION === void 0 ? void 0 : GNOME_VERSION.startsWith("3.36")) {
            GLib.timeout_add(GLib.PRIORITY_LOW, 500, () => {
                this.exception_selecting = true;
                overview.show();
                return false;
            });
        }
        else {
            GLib.idle_add(GLib.PRIORITY_LOW, () => {
                this.exception_selecting = true;
                overview.show();
                return false;
            });
        }
    }
    exit_modes() {
        this.tiler.exit(this);
        this.window_search.reset();
        this.window_search.close();
        this.overlay.visible = false;
    }
    find_monitor_to_retach(width, height) {
        if (!this.settings.workspaces_only_on_primary()) {
            for (const [index, display] of this.displays[1]) {
                if (display.area.width == width && display.area.height == height) {
                    return [index, display];
                }
            }
        }
        const primary = display.get_primary_monitor();
        return [primary, this.displays[1].get(primary)];
    }
    find_unused_workspace(monitor) {
        if (!this.auto_tiler)
            return [0, wom.get_workspace_by_index(0)];
        let id = 0;
        const tiled_windows = new Array();
        for (const [window] of this.auto_tiler.attached.iter()) {
            if (!this.auto_tiler.attached.contains(window))
                continue;
            const win = this.windows.get(window);
            if (win && !win.reassignment && win.meta.get_monitor() === monitor)
                tiled_windows.push(win);
        }
        cancel: while (true) {
            for (const window of tiled_windows) {
                if (window.workspace_id() === id) {
                    id += 1;
                    continue cancel;
                }
            }
            break;
        }
        let new_work;
        if (id + 1 === wom.get_n_workspaces()) {
            id += 1;
            new_work = wom.append_new_workspace(true, global.get_current_time());
        }
        else {
            new_work = wom.get_workspace_by_index(id);
        }
        return [id, new_work];
    }
    focus_window() {
        let focused = this.get_window(display.get_focus_window());
        if (!focused && this.last_focused) {
            focused = this.windows.get(this.last_focused);
        }
        return focused;
    }
    get_window(meta) {
        let entity = this.window_entity(meta);
        return entity ? this.windows.get(entity) : null;
    }
    load_settings() {
        this.set_gap_inner(this.settings.gap_inner());
        this.set_gap_outer(this.settings.gap_outer());
        this.gap_inner_prev = this.gap_inner;
        this.gap_outer_prev = this.gap_outer;
        this.column_size = this.settings.column_size() * this.dpi;
        this.row_size = this.settings.row_size() * this.dpi;
    }
    monitor_work_area(monitor) {
        const meta = wom
            .get_active_workspace()
            .get_work_area_for_monitor(monitor);
        return Rect.Rectangle.from_meta(meta);
    }
    on_active_workspace_changed() {
        this.exit_modes();
        this.last_focused = null;
        this.restack();
    }
    on_destroy(win) {
        var _a;
        const window = this.windows.get(win);
        if (!window)
            return;
        this.window_signals.take_with(win, (signals) => {
            for (const signal of signals) {
                window.meta.disconnect(signal);
            }
        });
        if (this.last_focused == win) {
            this.last_focused = null;
            if (this.auto_tiler) {
                const entity = this.auto_tiler.attached.get(win);
                if (entity) {
                    const fork = this.auto_tiler.forest.forks.get(entity);
                    if ((_a = fork === null || fork === void 0 ? void 0 : fork.right) === null || _a === void 0 ? void 0 : _a.is_window(win)) {
                        const entity = fork.right.inner.kind === 3
                            ? fork.right.inner.entities[0]
                            : fork.right.inner.entity;
                        this.windows.with(entity, (sibling) => sibling.activate());
                    }
                }
            }
        }
        const str = String(win);
        let value = this.tween_signals.get(str);
        if (value) {
            utils.source_remove(value[0]);
            this.tween_signals.delete(str);
        }
        if (this.auto_tiler)
            this.auto_tiler.detach_window(this, win);
        this.movements.remove(win);
        this.windows.remove(win);
        this.delete_entity(win);
    }
    on_display_move(_from_id, _to_id) {
        if (!this.auto_tiler)
            return;
    }
    on_focused(win) {
        var _a;
        this.exit_modes();
        this.size_signals_unblock(win);
        if (this.exception_selecting) {
            this.exception_add(win);
        }
        if (this.focus_trigger === null) {
            this.focus_trigger = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 300, () => {
                this.focus_trigger = null;
                return false;
            });
            this.prev_focused = this.last_focused;
            this.last_focused = win.entity;
        }
        function activate_in_stack(ext, stack, win) {
            var _a, _b;
            (_b = (_a = ext.auto_tiler) === null || _a === void 0 ? void 0 : _a.forest.stacks.get(stack.idx)) === null || _b === void 0 ? void 0 : _b.activate(win.entity);
        }
        if (this.auto_tiler) {
            win.meta.raise();
            const attached = this.auto_tiler.attached.get(win.entity);
            if (attached) {
                const fork = this.auto_tiler.forest.forks.get(attached);
                if (fork) {
                    if (fork.left.is_in_stack(win.entity)) {
                        activate_in_stack(this, fork.left.inner, win);
                    }
                    else if ((_a = fork.right) === null || _a === void 0 ? void 0 : _a.is_in_stack(win.entity)) {
                        activate_in_stack(this, fork.right.inner, win);
                    }
                }
            }
        }
        this.show_border_on_focused();
        if (this.auto_tiler && this.prev_focused !== null && win.is_tilable(this)) {
            let prev = this.windows.get(this.prev_focused);
            let is_attached = this.auto_tiler.attached.contains(this.prev_focused);
            if (prev && prev !== win && is_attached && prev.actor_exists() && prev.rect().contains(win.rect())) {
                if (prev.is_maximized()) {
                    prev.meta.unmaximize(Meta.MaximizeFlags.BOTH);
                }
                if (prev.meta.is_fullscreen()) {
                    prev.meta.unmake_fullscreen();
                }
            }
        }
        if (this.conf.log_on_focus) {
            let msg = `focused Window(${win.entity}) {\n`
                + `  class: "${win.meta.get_wm_class()}",\n`
                + `  cmdline: ${win.cmdline()},\n`
                + `  monitor: ${win.meta.get_monitor()},\n`
                + `  name: ${win.name(this)},\n`
                + `  rect: ${win.rect().fmt()},\n`
                + `  workspace: ${win.workspace_id()},\n`
                + `  xid: ${win.xid()},\n`
                + `  stack: ${win.stack},\n`;
            if (this.auto_tiler) {
                msg += `  fork: (${this.auto_tiler.attached.get(win.entity)}),\n`;
            }
            log.debug(msg + '}');
        }
    }
    on_tile_attach(entity, window) {
        if (this.auto_tiler) {
            if (!this.auto_tiler.attached.contains(window)) {
                this.windows.with(window, (w) => {
                    if (w.prev_rect === null) {
                        w.prev_rect = w.meta.get_frame_rect();
                    }
                });
            }
            this.auto_tiler.attached.insert(window, entity);
        }
    }
    on_tile_detach(win) {
        this.windows.with(win, (window) => {
            if (window.prev_rect && !window.ignore_detach) {
                this.register(Events.window_move(this, window, window.prev_rect));
                window.prev_rect = null;
            }
        });
    }
    show_border_on_focused() {
        this.hide_all_borders();
        const focus = this.focus_window();
        if (focus) {
            focus.show_border();
        }
    }
    hide_all_borders() {
        for (const win of this.windows.values()) {
            win.hide_border();
        }
    }
    maximized_on_active_display() {
        const aws = this.workspace_id();
        for (const window of this.windows.values()) {
            if (!window.actor_exists())
                continue;
            const wws = this.workspace_id(window);
            if (aws[0] === wws[0] && aws[1] === wws[1]) {
                if (window.is_maximized())
                    return true;
            }
        }
        return false;
    }
    on_gap_inner() {
        let current = this.settings.gap_inner();
        this.set_gap_inner(current);
        let prev_gap = this.gap_inner_prev / 4 / this.dpi;
        if (current != prev_gap) {
            this.update_inner_gap();
            Gio.Settings.sync();
        }
    }
    update_inner_gap() {
        if (this.auto_tiler) {
            for (const [entity,] of this.auto_tiler.forest.toplevel.values()) {
                const fork = this.auto_tiler.forest.forks.get(entity);
                if (fork) {
                    this.auto_tiler.tile(this, fork, fork.area);
                }
            }
        }
        else {
            this.update_snapped();
        }
    }
    on_gap_outer() {
        let current = this.settings.gap_outer();
        this.set_gap_outer(current);
        let prev_gap = this.gap_outer_prev / 4 / this.dpi;
        let diff = current - prev_gap;
        if (diff != 0) {
            this.set_gap_outer(current);
            this.update_outer_gap(diff);
            Gio.Settings.sync();
        }
    }
    update_outer_gap(diff) {
        if (this.auto_tiler) {
            for (const [entity,] of this.auto_tiler.forest.toplevel.values()) {
                const fork = this.auto_tiler.forest.forks.get(entity);
                if (fork) {
                    fork.area.array[0] += diff * 4;
                    fork.area.array[1] += diff * 4;
                    fork.area.array[2] -= diff * 8;
                    fork.area.array[3] -= diff * 8;
                    this.auto_tiler.tile(this, fork, fork.area);
                }
            }
        }
        else {
            this.update_snapped();
        }
    }
    on_grab_end(meta, op) {
        let win = this.get_window(meta);
        if (null === win || !win.is_tilable(this)) {
            return;
        }
        win.grab = false;
        this.size_signals_unblock(win);
        if (win.meta && win.meta.minimized) {
            this.on_minimize(win);
            return;
        }
        if (win.is_maximized()) {
            return;
        }
        const grab_op = this.grab_op;
        this.grab_op = null;
        if (!win) {
            log.error('an entity was dropped, but there is no window');
            return;
        }
        if (this.auto_tiler && op === undefined) {
            let mon = this.monitors.get(win.entity);
            if (mon) {
                let rect = win.meta.get_work_area_for_monitor(mon[0]);
                if (rect && Rect.Rectangle.from_meta(rect).contains(cursor_rect())) {
                    this.auto_tiler.reflow(this, win.entity);
                }
                else {
                    this.auto_tiler.on_drop(this, win, true);
                }
            }
            return;
        }
        if (!(grab_op && Ecs.entity_eq(grab_op.entity, win.entity))) {
            log.error(`grabbed entity is not the same as the one that was dropped`);
            return;
        }
        if (this.auto_tiler) {
            let crect = win.rect();
            const rect = grab_op.rect;
            if (is_move_op(op)) {
                this.monitors.insert(win.entity, [win.meta.get_monitor(), win.workspace_id()]);
                if ((rect.x != crect.x || rect.y != crect.y)) {
                    if (rect.contains(cursor_rect())) {
                        this.auto_tiler.reflow(this, win.entity);
                    }
                    else {
                        this.auto_tiler.on_drop(this, win);
                    }
                }
            }
            else {
                const fork_entity = this.auto_tiler.attached.get(win.entity);
                if (fork_entity) {
                    const forest = this.auto_tiler.forest;
                    const fork = forest.forks.get(fork_entity);
                    if (fork) {
                        if (win.stack) {
                            const tab_dimension = this.dpi * stack.TAB_HEIGHT;
                            crect.height += tab_dimension;
                            crect.y -= tab_dimension;
                        }
                        let top_level = forest.find_toplevel(this.workspace_id());
                        if (top_level) {
                            crect.clamp(forest.forks.get(top_level).area);
                        }
                        const movement = grab_op.operation(crect);
                        if (this.movement_is_valid(win, movement)) {
                            forest.resize(this, fork_entity, fork, win.entity, movement, crect);
                            forest.arrange(this, fork.workspace);
                        }
                        else {
                            forest.tile(this, fork, fork.area);
                        }
                    }
                    else {
                        log.error(`no fork component found`);
                    }
                }
                else {
                    log.error(`no fork entity found`);
                }
            }
        }
        else if (this.settings.snap_to_grid()) {
            this.tiler.snap(this, win);
        }
    }
    movement_is_valid(win, movement) {
        if ((movement & Movement.SHRINK) !== 0) {
            if ((movement & Movement.DOWN) !== 0) {
                const w = this.focus_selector.up(this, win);
                if (!w)
                    return false;
                const r = w.rect();
                if (r.y + r.height > win.rect().y)
                    return false;
            }
            else if ((movement & Movement.UP) !== 0) {
                const w = this.focus_selector.down(this, win);
                if (!w)
                    return false;
                const r = w.rect();
                if (r.y + r.height < win.rect().y)
                    return false;
            }
            else if ((movement & Movement.LEFT) !== 0) {
                const w = this.focus_selector.right(this, win);
                if (!w)
                    return false;
                const r = w.rect();
                if (r.x + r.width < win.rect().x)
                    return false;
            }
            else if ((movement & Movement.RIGHT) !== 0) {
                const w = this.focus_selector.left(this, win);
                if (!w)
                    return false;
                const r = w.rect();
                if (r.x + r.width > win.rect().x)
                    return false;
            }
        }
        return true;
    }
    workspace_window_move(win, prev_monitor, next_monitor) {
        const prev_area = win.meta.get_work_area_for_monitor(prev_monitor);
        const next_area = win.meta.get_work_area_for_monitor(next_monitor);
        if (prev_area && next_area) {
            let rect = win.rect();
            rect.x = next_area.x + rect.x - prev_area.x;
            rect.y = next_area.y + rect.y - prev_area.y;
            rect.clamp(next_area);
            this.register(Events.window_move(this, win, rect));
        }
    }
    move_monitor(direction) {
        const win = this.focus_window();
        if (!win)
            return;
        const prev_monitor = win.meta.get_monitor();
        let next_monitor = Tiling.locate_monitor(win, direction);
        if (next_monitor !== null) {
            if (this.auto_tiler && !this.contains_tag(win.entity, Tags.Floating)) {
                win.ignore_detach = true;
                this.auto_tiler.detach_window(this, win.entity);
                this.auto_tiler.attach_to_workspace(this, win, [next_monitor, win.workspace_id()]);
            }
            else {
                this.workspace_window_move(win, prev_monitor, next_monitor);
            }
        }
        win.activate_after_move = true;
    }
    move_workspace(direction) {
        const win = this.focus_window();
        if (!win)
            return;
        const workspace_move = (direction) => {
            const ws = win.meta.get_workspace();
            let neighbor = ws.get_neighbor(direction);
            const last_window = () => {
                const last = wom.get_n_workspaces() - 2 === ws.index() && ws.n_windows === 1;
                return last;
            };
            const move_to_neighbor = (neighbor) => {
                const monitor = win.meta.get_monitor();
                if (this.auto_tiler && !this.contains_tag(win.entity, Tags.Floating)) {
                    win.ignore_detach = true;
                    this.auto_tiler.detach_window(this, win.entity);
                    this.auto_tiler.attach_to_workspace(this, win, [monitor, neighbor.index()]);
                    if (win.meta.minimized) {
                        this.size_signals_block(win);
                        win.meta.change_workspace_by_index(neighbor.index(), false);
                        this.size_signals_unblock(win);
                    }
                }
                else {
                    this.workspace_window_move(win, monitor, monitor);
                }
                win.activate_after_move = true;
            };
            if (neighbor && neighbor.index() !== ws.index()) {
                move_to_neighbor(neighbor);
            }
            else if (direction === Meta.MotionDirection.DOWN && !last_window()) {
                if (this.settings.dynamic_workspaces()) {
                    neighbor = wom.append_new_workspace(false, global.get_current_time());
                }
                else {
                    return;
                }
            }
            else if (direction === Meta.MotionDirection.UP && ws.index() === 0) {
                if (this.settings.dynamic_workspaces()) {
                    wom.append_new_workspace(false, global.get_current_time());
                    this.on_workspace_modify(() => true, (current) => current + 1, true);
                    neighbor = wom.get_workspace_by_index(0);
                    if (!neighbor)
                        return;
                    move_to_neighbor(neighbor);
                }
                else {
                    return;
                }
            }
            else {
                return;
            }
            this.size_signals_block(win);
            win.meta.change_workspace_by_index(neighbor.index(), true);
            neighbor.activate_with_focus(win.meta, global.get_current_time());
            this.size_signals_unblock(win);
        };
        switch (direction) {
            case Meta.DisplayDirection.DOWN:
                workspace_move(Meta.MotionDirection.DOWN);
                break;
            case Meta.DisplayDirection.UP:
                workspace_move(Meta.MotionDirection.UP);
                break;
        }
        if (this.auto_tiler)
            this.restack();
    }
    on_grab_start(meta) {
        if (!meta)
            return;
        let win = this.get_window(meta);
        if (win) {
            win.grab = true;
            if (win.is_tilable(this)) {
                let entity = win.entity;
                let rect = win.rect();
                this.unset_grab_op();
                this.grab_op = new GrabOp.GrabOp(entity, rect);
                this.size_signals_block(win);
            }
        }
    }
    on_gtk_shell_changed() {
        load_theme(this.settings.is_dark_shell() ? Style.Dark : Style.Light);
    }
    on_gtk_theme_change() {
        load_theme(this.settings.is_dark_shell() ? Style.Dark : Style.Light);
    }
    on_maximize(win) {
        if (win.is_maximized()) {
            const actor = win.meta.get_compositor_private();
            if (actor)
                global.window_group.set_child_above_sibling(actor, null);
            if (win.meta.is_fullscreen()) {
                this.size_changed_block();
                win.meta.unmake_fullscreen();
                win.meta.maximize(Meta.MaximizeFlags.BOTH);
                this.size_changed_unblock();
            }
            this.on_monitor_changed(win, (_cfrom, cto, workspace) => {
                var _a;
                if (win) {
                    win.ignore_detach = true;
                    this.monitors.insert(win.entity, [cto, workspace]);
                    (_a = this.auto_tiler) === null || _a === void 0 ? void 0 : _a.detach_window(this, win.entity);
                }
            });
        }
        else {
            this.register_fn(() => {
                if (this.auto_tiler) {
                    let fork_ent = this.auto_tiler.attached.get(win.entity);
                    if (fork_ent) {
                        let fork = this.auto_tiler.forest.forks.get(fork_ent);
                        if (fork)
                            this.auto_tiler.tile(this, fork, fork.area);
                    }
                }
            });
        }
    }
    on_minimize(win) {
        if (this.auto_tiler) {
            if (win.meta.minimized) {
                const attached = this.auto_tiler.attached.get(win.entity);
                if (!attached)
                    return;
                const fork = this.auto_tiler.forest.forks.get(attached);
                if (!fork)
                    return;
                let attachment;
                if (win.stack !== null) {
                    attachment = win.stack;
                }
                else {
                    attachment = fork.left.is_window(win.entity);
                }
                win.was_attached_to = [attached, attachment];
                this.auto_tiler.detach_window(this, win.entity);
            }
            else if (!this.contains_tag(win.entity, Tags.Floating)) {
                if (win.was_attached_to) {
                    const [entity, attachment] = win.was_attached_to;
                    delete win.was_attached_to;
                    const tiler = this.auto_tiler;
                    const fork = tiler.forest.forks.get(entity);
                    if (fork) {
                        if (typeof attachment === "boolean") {
                            tiler.forest.attach_fork(this, fork, win.entity, attachment);
                            tiler.tile(this, fork, fork.area);
                            return;
                        }
                        else {
                            const stack = tiler.forest.stacks.get(attachment);
                            if (stack) {
                                const stack_info = tiler.find_stack(stack.active);
                                if (stack_info) {
                                    const node = stack_info[1].inner;
                                    win.stack = attachment;
                                    node.entities.push(win.entity);
                                    tiler.update_stack(this, node);
                                    tiler.forest.on_attach(fork.entity, win.entity);
                                    stack.activate(win.entity);
                                    tiler.tile(this, fork, fork.area);
                                    return;
                                }
                            }
                        }
                    }
                }
                this.auto_tiler.auto_tile(this, win, false);
            }
        }
    }
    on_monitor_changed(win, func) {
        const actual_monitor = win.meta.get_monitor();
        const actual_workspace = win.workspace_id();
        const monitor = this.monitors.get(win.entity);
        if (monitor) {
            const [expected_monitor, expected_workspace] = monitor;
            if (expected_monitor != actual_monitor || actual_workspace != expected_workspace) {
                func(expected_monitor, actual_monitor, actual_workspace);
            }
        }
        else {
            func(null, actual_monitor, actual_workspace);
        }
    }
    on_overview_hidden() {
    }
    on_overview_shown() {
        this.exit_modes();
        this.unset_grab_op();
    }
    on_show_window_titles() {
        for (const window of this.windows.values()) {
            if (window.meta.is_client_decorated())
                continue;
            if (this.settings.show_title()) {
                window.decoration_show(this);
            }
            else {
                window.decoration_hide(this);
            }
        }
    }
    on_smart_gap() {
        if (this.auto_tiler) {
            const smart_gaps = this.settings.smart_gaps();
            for (const [entity, [mon,]] of this.auto_tiler.forest.toplevel.values()) {
                const node = this.auto_tiler.forest.forks.get(entity);
                if ((node === null || node === void 0 ? void 0 : node.right) === null) {
                    this.auto_tiler.update_toplevel(this, node, mon, smart_gaps);
                }
            }
        }
    }
    on_window_create(window, actor) {
        let win = this.get_window(window);
        if (win) {
            const entity = win.entity;
            actor.connect('destroy', () => {
                if (win && win.border)
                    win.border.destroy();
                this.on_destroy(entity);
                return false;
            });
            if (win.is_tilable(this)) {
                this.connect_window(win);
            }
            else {
                window.raise();
                window.unminimize();
                window.activate(global.get_current_time());
            }
        }
    }
    on_workspace_added(_number) {
        this.ignore_display_update = true;
    }
    on_workspace_changed(win) {
        if (this.auto_tiler && !this.contains_tag(win.entity, Tags.Floating)) {
            const id = this.workspace_id(win);
            const prev_id = this.monitors.get(win.entity);
            if (!prev_id || id[0] != prev_id[0] || id[1] != prev_id[1]) {
                win.ignore_detach = true;
                this.monitors.insert(win.entity, id);
                this.auto_tiler.detach_window(this, win.entity);
                this.auto_tiler.attach_to_workspace(this, win, id);
            }
            if (win.meta.minimized) {
                this.size_signals_block(win);
                win.meta.unminimize();
                this.size_signals_unblock(win);
            }
        }
    }
    on_workspace_index_changed(prev, next) {
        this.on_workspace_modify((current) => current == prev, (_) => next);
    }
    on_workspace_modify(condition, modify, change_workspace = false) {
        function window_move(ext, entity, ws) {
            if (change_workspace) {
                const window = ext.windows.get(entity);
                if (!window || !window.actor_exists() || window.meta.is_on_all_workspaces())
                    return;
                ext.size_signals_block(window);
                window.meta.change_workspace_by_index(ws, false);
                ext.size_signals_unblock(window);
            }
        }
        if (this.auto_tiler) {
            for (const [entity, monitor] of this.auto_tiler.forest.toplevel.values()) {
                if (condition(monitor[1])) {
                    const value = modify(monitor[1]);
                    monitor[1] = value;
                    let fork = this.auto_tiler.forest.forks.get(entity);
                    if (fork) {
                        fork.workspace = value;
                        for (const child of this.auto_tiler.forest.iter(entity)) {
                            if (child.inner.kind === 1) {
                                fork = this.auto_tiler.forest.forks.get(child.inner.entity);
                                if (fork)
                                    fork.workspace = value;
                            }
                            else if (child.inner.kind === 2) {
                                window_move(this, child.inner.entity, value);
                            }
                            else if (child.inner.kind === 3) {
                                let stack = this.auto_tiler.forest.stacks.get(child.inner.idx);
                                if (stack) {
                                    stack.workspace = value;
                                    for (const entity of child.inner.entities) {
                                        window_move(this, entity, value);
                                    }
                                    stack.restack();
                                }
                            }
                        }
                    }
                }
            }
            for (const window of this.windows.values()) {
                if (!window.actor_exists())
                    this.auto_tiler.detach_window(this, window.entity);
            }
        }
        else {
            let to_delete = new Array();
            for (const [entity, window] of this.windows.iter()) {
                if (!window.actor_exists()) {
                    to_delete.push(entity);
                    continue;
                }
                const ws = window.workspace_id();
                if (condition(ws)) {
                    window_move(this, entity, modify(ws));
                }
            }
            for (const e of to_delete)
                this.delete_entity(e);
        }
    }
    on_workspace_removed(number) {
        this.on_workspace_modify((current) => current > number, (prev) => prev - 1);
    }
    restack() {
        let attempts = 0;
        GLib.timeout_add(GLib.PRIORITY_LOW, 50, () => {
            if (this.auto_tiler) {
                for (const container of this.auto_tiler.forest.stacks.values()) {
                    container.restack();
                }
            }
            let x = attempts;
            attempts += 1;
            return x < 10;
        });
    }
    set_gap_inner(gap) {
        this.gap_inner_prev = this.gap_inner;
        this.gap_inner = gap * 4 * this.dpi;
        this.gap_inner_half = this.gap_inner / 2;
    }
    set_gap_outer(gap) {
        this.gap_outer_prev = this.gap_outer;
        this.gap_outer = gap * 4 * this.dpi;
    }
    set_overlay(rect) {
        this.overlay.x = rect.x;
        this.overlay.y = rect.y;
        this.overlay.width = rect.width;
        this.overlay.height = rect.height;
    }
    signals_attach() {
        this.conf_watch = this.attach_config();
        this.tiler.queue.start(100, (movement) => {
            movement();
            return true;
        });
        const workspace_manager = wom;
        for (const [, ws] of iter_workspaces(workspace_manager)) {
            let index = ws.index();
            this.connect(ws, 'notify::workspace-index', () => {
                if (ws !== null) {
                    let new_index = ws.index();
                    this.on_workspace_index_changed(index, new_index);
                    index = new_index;
                }
            });
        }
        this.connect(display, 'workareas-changed', () => {
            this.update_display_configuration(true);
        });
        this.size_changed_signal = this.connect(wim, 'size-change', (_, actor, event, _before, _after) => {
            if (this.auto_tiler) {
                let win = this.get_window(actor.get_meta_window());
                if (!win)
                    return;
                if (event === Meta.SizeChange.MAXIMIZE || event === Meta.SizeChange.UNMAXIMIZE) {
                    this.register(Events.window_event(win, WindowEvent.Maximize));
                }
                else {
                    this.register(Events.window_event(win, WindowEvent.Fullscreen));
                }
            }
        });
        this.connect(this.settings.ext, 'changed', (_s, key) => {
            switch (key) {
                case 'active-hint':
                    this.show_border_on_focused();
                    break;
                case 'gap-inner':
                    this.on_gap_inner();
                    break;
                case 'gap-outer':
                    this.on_gap_outer();
                    break;
                case 'show-title':
                    this.on_show_window_titles();
                    break;
                case 'smart-gaps':
                    this.on_smart_gap();
                    this.show_border_on_focused();
            }
        });
        if (this.settings.mutter) {
            this.connect(this.settings.mutter, 'changed::workspaces-only-on-primary', () => {
                this.register(Events.global(GlobalEvent.MonitorsChanged));
            });
        }
        this.connect(layoutManager, 'monitors-changed', () => {
            this.register(Events.global(GlobalEvent.MonitorsChanged));
        });
        this.connect(sessionMode, 'updated', () => {
            if (indicator) {
                indicator.button.visible = !sessionMode.isLocked;
            }
            if (sessionMode.isLocked) {
                this.exit_modes();
            }
        });
        this.connect(overview, 'showing', () => {
            this.register(Events.global(GlobalEvent.OverviewShown));
        });
        this.connect(overview, 'hiding', () => {
            const window = this.focus_window();
            if (window) {
                this.on_focused(window);
            }
            this.register(Events.global(GlobalEvent.OverviewHidden));
        });
        this.register_fn(() => {
            if (screenShield === null || screenShield === void 0 ? void 0 : screenShield.locked)
                this.update_display_configuration(false);
            this.connect(display, 'notify::focus-window', () => {
                const window = this.focus_window();
                if (window)
                    this.on_focused(window);
            });
            const window = this.focus_window();
            if (window) {
                this.on_focused(window);
            }
            return false;
        });
        this.connect(display, 'window_created', (_, window) => {
            this.register({ tag: 3, window });
        });
        this.connect(display, 'grab-op-begin', (_, _display, win) => {
            this.on_grab_start(win);
        });
        this.connect(display, 'grab-op-end', (_, _display, win, op) => {
            this.register_fn(() => this.on_grab_end(win, op));
        });
        this.connect(overview, 'window-drag-begin', (_, win) => {
            this.on_grab_start(win);
        });
        this.connect(overview, 'window-drag-end', (_, win) => {
            this.register_fn(() => this.on_grab_end(win));
        });
        this.connect(overview, 'window-drag-cancelled', () => {
            this.unset_grab_op();
        });
        this.connect(wim, 'switch-workspace', () => {
            this.hide_all_borders();
        });
        this.connect(workspace_manager, 'active-workspace-changed', () => {
            this.on_active_workspace_changed();
        });
        this.connect(workspace_manager, 'workspace-removed', (_, number) => {
            this.on_workspace_removed(number);
        });
        this.connect(workspace_manager, 'workspace-added', (_, number) => {
            this.on_workspace_added(number);
        });
        this.connect(workspace_manager, 'showing-desktop-changed', () => {
            this.hide_all_borders();
            this.last_focused = null;
        });
        St.ThemeContext.get_for_stage(global.stage)
            .connect('notify::scale-factor', () => this.update_scale());
        if (this.settings.tile_by_default() && !this.auto_tiler) {
            this.auto_tiler = new auto_tiler.AutoTiler(new Forest.Forest()
                .connect_on_attach(this.on_tile_attach.bind(this))
                .connect_on_detach(this.on_tile_detach.bind(this)), this.register_storage());
        }
        if (this.init) {
            for (const window of this.tab_list(Meta.TabList.NORMAL, null)) {
                this.register({ tag: 3, window: window.meta });
            }
            this.register_fn(() => this.init = false);
        }
    }
    signals_remove() {
        for (const [object, signals] of this.signals) {
            for (const signal of signals) {
                object.disconnect(signal);
            }
        }
        if (this.conf_watch) {
            this.conf_watch[0].disconnect(this.conf_watch[1]);
            this.conf_watch = null;
        }
        this.tiler.queue.stop();
        this.signals.clear();
    }
    size_changed_block() {
        utils.block_signal(wim, this.size_changed_signal);
    }
    size_changed_unblock() {
        utils.unblock_signal(wim, this.size_changed_signal);
    }
    size_signals_block(win) {
        this.add_tag(win.entity, Tags.Blocked);
    }
    size_signals_unblock(win) {
        this.delete_tag(win.entity, Tags.Blocked);
    }
    snap_windows() {
        for (const window of this.windows.values()) {
            if (window.is_tilable(this))
                this.tiler.snap(this, window);
        }
    }
    switch_to_workspace(id) {
        var _a;
        (_a = this.workspace_by_id(id)) === null || _a === void 0 ? void 0 : _a.activate(global.get_current_time());
    }
    stop_launcher_services() {
        this.window_search.stop_services();
    }
    tab_list(tablist, workspace) {
        const windows = display.get_tab_list(tablist, workspace);
        const matched = new Array();
        for (const window of windows) {
            const win = this.get_window(window);
            if (win)
                matched.push(win);
        }
        return matched;
    }
    *tiled_windows() {
        for (const entity of this.entities()) {
            if (this.contains_tag(entity, Tags.Tiled)) {
                yield entity;
            }
        }
    }
    toggle_tiling() {
        if (this.settings.tile_by_default()) {
            this.auto_tile_off();
        }
        else {
            this.auto_tile_on();
        }
    }
    auto_tile_off() {
        this.hide_all_borders();
        if (this.schedule_idle(() => {
            this.auto_tile_off();
            return false;
        })) {
            return;
        }
        if (this.auto_tiler) {
            this.unregister_storage(this.auto_tiler.attached);
            this.auto_tiler.destroy(this);
            this.auto_tiler = null;
            this.settings.set_tile_by_default(false);
            this.tiling_toggle_switch.setToggleState(false);
            this.button.icon.gicon = this.button_gio_icon_auto_off;
            if (this.settings.active_hint()) {
                this.show_border_on_focused();
            }
        }
    }
    auto_tile_on() {
        this.hide_all_borders();
        if (this.schedule_idle(() => {
            this.auto_tile_on();
            return false;
        })) {
            return;
        }
        const original = this.active_workspace();
        let tiler = new auto_tiler.AutoTiler(new Forest.Forest()
            .connect_on_attach(this.on_tile_attach.bind(this))
            .connect_on_detach(this.on_tile_detach.bind(this)), this.register_storage());
        this.auto_tiler = tiler;
        this.settings.set_tile_by_default(true);
        this.tiling_toggle_switch.setToggleState(true);
        this.button.icon.gicon = this.button_gio_icon_auto_on;
        for (const window of this.windows.values()) {
            if (window.is_tilable(this)) {
                let actor = window.meta.get_compositor_private();
                if (actor) {
                    if (!window.meta.minimized) {
                        tiler.auto_tile(this, window, false);
                    }
                }
            }
        }
        this.register_fn(() => this.switch_to_workspace(original));
    }
    schedule_idle(func) {
        if (!this.movements.is_empty()) {
            GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
                return func();
            });
            return true;
        }
        return false;
    }
    should_ignore_workspace(monitor) {
        return this.settings.workspaces_only_on_primary() && monitor !== global.display.get_primary_monitor();
    }
    unset_grab_op() {
        if (this.grab_op !== null) {
            let window = this.windows.get(this.grab_op.entity);
            if (window)
                this.size_signals_unblock(window);
            this.grab_op = null;
        }
    }
    update_display_configuration(workareas_only) {
        if (!this.auto_tiler || sessionMode.isLocked)
            return;
        if (this.ignore_display_update) {
            this.ignore_display_update = false;
            return;
        }
        if (layoutManager.monitors.length === 0)
            return;
        const primary_display = global.display.get_primary_monitor();
        const primary_display_ready = (ext) => {
            const area = global.display.get_monitor_geometry(primary_display);
            const work_area = ext.monitor_work_area(primary_display);
            if (!area || !work_area)
                return false;
            return !(area.width === work_area.width && area.height === work_area.height);
        };
        function displays_ready() {
            const monitors = global.display.get_n_monitors();
            if (monitors === 0)
                return false;
            for (let i = 0; i < monitors; i += 1) {
                const display = global.display.get_monitor_geometry(i);
                if (!display)
                    return false;
                if (display.width < 1 || display.height < 1)
                    return false;
            }
            return true;
        }
        if (!displays_ready() || !primary_display_ready(this)) {
            if (this.displays_updating !== null)
                return;
            if (this.workareas_update !== null)
                GLib.source_remove(this.workareas_update);
            this.workareas_update = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
                this.register_fn(() => {
                    this.update_display_configuration(workareas_only);
                });
                this.workareas_update = null;
                return false;
            });
            return;
        }
        const update_tiling = () => {
            if (!this.auto_tiler)
                return;
            for (const f of this.auto_tiler.forest.forks.values()) {
                if (!f.is_toplevel)
                    continue;
                const display = this.monitor_work_area(f.monitor);
                if (display) {
                    const area = new Rect.Rectangle([display.x, display.y, display.width, display.height]);
                    f.smart_gapped = false;
                    f.set_area(area.clone());
                    this.auto_tiler.update_toplevel(this, f, f.monitor, this.settings.smart_gaps());
                }
            }
        };
        let migrations = new Array();
        const apply_migrations = (assigned_monitors) => {
            if (!migrations)
                return;
            new exec.OnceExecutor(migrations)
                .start(500, ([fork, new_monitor, workspace, find_workspace]) => {
                let new_workspace;
                if (find_workspace) {
                    if (assigned_monitors.has(new_monitor)) {
                        [new_workspace] = this.find_unused_workspace(new_monitor);
                    }
                    else {
                        assigned_monitors.add(new_monitor);
                        new_workspace = 0;
                    }
                }
                else {
                    new_workspace = fork.workspace;
                }
                fork.migrate(this, forest, workspace, new_monitor, new_workspace);
                fork.set_ratio(fork.length() / 2);
                return true;
            }, () => update_tiling());
        };
        function mark_for_reassignment(ext, fork) {
            for (const win of forest.iter(fork, node.NodeKind.WINDOW)) {
                if (win.inner.kind === 2) {
                    const entity = win.inner.entity;
                    const window = ext.windows.get(entity);
                    if (window)
                        window.reassignment = true;
                }
            }
        }
        const [old_primary, old_displays] = this.displays;
        const changes = new Map();
        for (const [entity, w] of this.windows.iter()) {
            if (!w.actor_exists())
                continue;
            this.monitors.with(entity, ([mon,]) => {
                const assignment = mon === old_primary ? primary_display : w.meta.get_monitor();
                changes.set(mon, assignment);
            });
        }
        const updated = new Map();
        for (const monitor of layoutManager.monitors) {
            const mon = monitor;
            const area = new Rect.Rectangle([mon.x, mon.y, mon.width, mon.height]);
            const ws = this.monitor_work_area(mon.index);
            updated.set(mon.index, { area, ws });
        }
        const forest = this.auto_tiler.forest;
        if (old_displays.size === updated.size) {
            update_tiling();
            this.displays = [primary_display, updated];
            return;
        }
        this.displays = [primary_display, updated];
        if (utils.map_eq(old_displays, updated)) {
            return;
        }
        if (this.displays_updating !== null)
            GLib.source_remove(this.displays_updating);
        if (this.workareas_update !== null) {
            GLib.source_remove(this.workareas_update);
            this.workareas_update = null;
        }
        this.displays_updating = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 2000, () => {
            (() => {
                if (!this.auto_tiler)
                    return;
                const toplevels = new Array();
                const assigned_monitors = new Set();
                for (const [old_mon, new_mon] of changes) {
                    if (old_mon === new_mon)
                        assigned_monitors.add(new_mon);
                }
                for (const f of forest.forks.values()) {
                    if (f.is_toplevel) {
                        toplevels.push(f);
                        let migration = null;
                        const displays = this.displays[1];
                        for (const [old_monitor, new_monitor] of changes) {
                            const display = displays.get(new_monitor);
                            if (!display)
                                continue;
                            if (f.monitor === old_monitor) {
                                f.monitor = new_monitor;
                                f.workspace = 0;
                                migration = [f, new_monitor, display.ws, true];
                            }
                        }
                        if (!migration) {
                            const display = displays.get(f.monitor);
                            if (display) {
                                migration = [f, f.monitor, display.ws, false];
                            }
                        }
                        if (migration) {
                            mark_for_reassignment(this, migration[0].entity);
                            migrations.push(migration);
                        }
                    }
                }
                apply_migrations(assigned_monitors);
                return;
            })();
            this.displays_updating = null;
            return false;
        });
    }
    update_scale() {
        const new_dpi = St.ThemeContext.get_for_stage(global.stage).scale_factor;
        const diff = new_dpi / this.dpi;
        this.dpi = new_dpi;
        this.column_size *= diff;
        this.row_size *= diff;
        this.gap_inner_prev *= diff;
        this.gap_inner *= diff;
        this.gap_inner_half *= diff;
        this.gap_outer_prev *= diff;
        this.gap_outer *= diff;
        this.update_inner_gap();
        this.update_outer_gap(diff);
    }
    update_snapped() {
        for (const entity of this.snapped.find((val) => val)) {
            const window = this.windows.get(entity);
            if (window)
                this.tiler.snap(this, window);
        }
    }
    window_entity(meta) {
        if (!meta)
            return null;
        let id;
        try {
            id = meta.get_stable_sequence();
        }
        catch (e) {
            return null;
        }
        let entity = this.ids.find((comp) => comp == id).next().value;
        if (!entity) {
            const actor = meta.get_compositor_private();
            if (!actor)
                return null;
            let window_app, name;
            try {
                window_app = Window.window_tracker.get_window_app(meta);
                name = window_app.get_name().replace(/&/g, "&amp;");
            }
            catch (e) {
                return null;
            }
            entity = this.create_entity();
            this.ids.insert(entity, id);
            this.names.insert(entity, name);
            let win = new Window.ShellWindow(entity, meta, window_app, this);
            this.windows.insert(entity, win);
            this.monitors.insert(entity, [win.meta.get_monitor(), win.workspace_id()]);
            if (this.auto_tiler && !win.meta.minimized && win.is_tilable(this)) {
                let id = actor.connect('first-frame', () => {
                    var _a;
                    (_a = this.auto_tiler) === null || _a === void 0 ? void 0 : _a.auto_tile(this, win, this.init);
                    actor.disconnect(id);
                });
            }
        }
        return entity;
    }
    *windows_at_pointer(cursor, monitor, workspace) {
        for (const entity of this.monitors.find((m) => m[0] == monitor && m[1] == workspace)) {
            let window = this.windows.with(entity, (window) => {
                return window.rect().contains(cursor) ? window : null;
            });
            if (window)
                yield window;
        }
    }
    cursor_status() {
        const cursor = cursor_rect();
        const rect = new Meta.Rectangle({ x: cursor.x, y: cursor.y, width: 1, height: 1 });
        const monitor = display.get_monitor_index_for_rect(rect);
        return [cursor, monitor];
    }
    workspace_by_id(id) {
        return wom.get_workspace_by_index(id);
    }
    workspace_id(window = null) {
        let id = window
            ? [window.meta.get_monitor(), window.workspace_id()]
            : [this.active_monitor(), this.active_workspace()];
        id[0] = Math.max(0, id[0]);
        id[1] = Math.max(0, id[1]);
        return id;
    }
}
let ext = null;
let indicator = null;
function init() {
    log.info("init");
}
function enable() {
    log.info("enable");
    if (!ext) {
        ext = new Ext();
        ext.register_fn(() => {
            if (ext === null || ext === void 0 ? void 0 : ext.auto_tiler)
                ext.snap_windows();
        });
    }
    if (ext.was_locked) {
        ext.was_locked = false;
        return;
    }
    ext.signals_attach();
    layoutManager.addChrome(ext.overlay);
    if (!indicator) {
        indicator = new PanelSettings.Indicator(ext);
        panel.addToStatusArea('pop-shell', indicator.button);
    }
    ext.keybindings.enable(ext.keybindings.global)
        .enable(ext.keybindings.window_focus);
    if (ext.settings.tile_by_default()) {
        ext.auto_tile_on();
    }
}
function disable() {
    log.info("disable");
    if (ext) {
        if (sessionMode.isLocked) {
            ext.was_locked = true;
            return;
        }
        ext.signals_remove();
        ext.exit_modes();
        ext.stop_launcher_services();
        ext.hide_all_borders();
        layoutManager.removeChrome(ext.overlay);
        ext.keybindings.disable(ext.keybindings.global)
            .disable(ext.keybindings.window_focus);
        if (ext.auto_tiler) {
            ext.auto_tiler.destroy(ext);
            ext.auto_tiler = null;
        }
    }
    if (indicator) {
        indicator.destroy();
        indicator = null;
    }
}
function stylesheet_path(name) { return Me.path + "/" + name + ".css"; }
function load_theme(style) {
    let pop_stylesheet = Number(style);
    try {
        const theme_context = St.ThemeContext.get_for_stage(global.stage);
        const existing_theme = theme_context.get_theme();
        const pop_stylesheet_path = STYLESHEET_PATHS[pop_stylesheet];
        if (existing_theme) {
            for (const s of STYLESHEETS) {
                existing_theme.unload_stylesheet(s);
            }
            existing_theme.load_stylesheet(STYLESHEETS[pop_stylesheet]);
            theme_context.set_theme(existing_theme);
        }
        else {
            setThemeStylesheet(pop_stylesheet_path);
            loadTheme();
        }
        return pop_stylesheet_path;
    }
    catch (e) {
        log.error("failed to load stylesheet: " + e);
        return null;
    }
}
function* iter_workspaces(manager) {
    let idx = 0;
    let ws = manager.get_workspace_by_index(idx);
    while (ws !== null) {
        yield [idx, ws];
        idx += 1;
        ws = manager.get_workspace_by_index(idx);
    }
}
//# sourceMappingURL=extension.js.map