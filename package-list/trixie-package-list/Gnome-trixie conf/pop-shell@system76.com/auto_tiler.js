const Me = imports.misc.extensionUtils.getCurrentExtension();
const ecs = Me.imports.ecs;
const lib = Me.imports.lib;
const log = Me.imports.log;
const node = Me.imports.node;
const result = Me.imports.result;
const stack = Me.imports.stack;
const { Stack } = stack;
const { Ok, Err, ERR } = result;
const { NodeKind } = node;
const Tags = Me.imports.tags;
var AutoTiler = class AutoTiler {
    constructor(forest, attached) {
        this.forest = forest;
        this.attached = attached;
    }
    attach_swap(ext, a, b) {
        var _a, _b;
        const a_ent = this.attached.get(a), b_ent = this.attached.get(b);
        let a_win = ext.windows.get(a), b_win = ext.windows.get(b);
        if (!a_ent || !b_ent || !a_win || !b_win)
            return;
        const a_fork = this.forest.forks.get(a_ent), b_fork = this.forest.forks.get(b_ent);
        if (!a_fork || !b_fork)
            return;
        const a_stack = a_win.stack, b_stack = b_win.stack;
        if (ext.auto_tiler) {
            if (a_win.stack !== null) {
                const stack = ext.auto_tiler.forest.stacks.get(a_win.stack);
                if (stack) {
                    a = stack.active;
                    a_win = ext.windows.get(a);
                    if (!a_win)
                        return;
                    stack.deactivate(a_win);
                }
            }
            if (b_win.stack !== null) {
                const stack = ext.auto_tiler.forest.stacks.get(b_win.stack);
                if (stack) {
                    b = stack.active;
                    b_win = ext.windows.get(b);
                    if (!b_win)
                        return;
                    stack.deactivate(b_win);
                }
            }
        }
        const a_fn = a_fork.replace_window(ext, a_win, b_win);
        this.forest.on_attach(a_ent, b);
        const b_fn = b_fork.replace_window(ext, b_win, a_win);
        this.forest.on_attach(b_ent, a);
        if (a_fn)
            a_fn();
        if (b_fn)
            b_fn();
        a_win.stack = b_stack;
        b_win.stack = a_stack;
        (_a = a_win.meta.get_compositor_private()) === null || _a === void 0 ? void 0 : _a.show();
        (_b = b_win.meta.get_compositor_private()) === null || _b === void 0 ? void 0 : _b.show();
        this.tile(ext, a_fork, a_fork.area);
        this.tile(ext, b_fork, b_fork.area);
    }
    update_toplevel(ext, fork, monitor, smart_gaps) {
        let rect = ext.monitor_work_area(monitor);
        fork.smart_gapped = smart_gaps && fork.right === null;
        if (!fork.smart_gapped) {
            rect.x += ext.gap_outer;
            rect.y += ext.gap_outer;
            rect.width -= ext.gap_outer * 2;
            rect.height -= ext.gap_outer * 2;
        }
        if (fork.left.inner.kind === 2) {
            const win = ext.windows.get(fork.left.inner.entity);
            if (win) {
                win.smart_gapped = fork.smart_gapped;
            }
        }
        let ratio;
        if (fork.orientation_changed) {
            fork.orientation_changed = false;
            ratio = fork.length_left / fork.depth();
        }
        else {
            ratio = fork.length_left / fork.length();
        }
        fork.area = fork.set_area(rect.clone());
        fork.length_left = Math.round(ratio * fork.length());
        this.tile(ext, fork, fork.area);
    }
    attach_to_monitor(ext, win, workspace_id, smart_gaps) {
        let rect = ext.monitor_work_area(workspace_id[0]);
        if (!smart_gaps) {
            rect.x += ext.gap_outer;
            rect.y += ext.gap_outer;
            rect.width -= ext.gap_outer * 2;
            rect.height -= ext.gap_outer * 2;
        }
        const [entity, fork] = this.forest.create_toplevel(win.entity, rect.clone(), workspace_id);
        this.forest.on_attach(entity, win.entity);
        fork.smart_gapped = smart_gaps;
        win.smart_gapped = smart_gaps;
        this.tile(ext, fork, rect);
    }
    attach_to_window(ext, attachee, attacher, move_by, stack_from_left = true) {
        let attached = this.forest.attach_window(ext, attachee.entity, attacher.entity, move_by, stack_from_left);
        if (attached) {
            const [, fork] = attached;
            const monitor = ext.monitors.get(attachee.entity);
            if (monitor) {
                if (fork.is_toplevel && fork.smart_gapped && fork.right) {
                    fork.smart_gapped = false;
                    let rect = ext.monitor_work_area(fork.monitor);
                    rect.x += ext.gap_outer;
                    rect.y += ext.gap_outer;
                    rect.width -= ext.gap_outer * 2;
                    rect.height -= ext.gap_outer * 2;
                    fork.set_area(rect);
                }
                this.tile(ext, fork, fork.area.clone());
                return true;
            }
            else {
                log.error(`missing monitor association for Window(${attachee.entity})`);
            }
        }
    }
    attach_to_workspace(ext, win, id) {
        if (ext.should_ignore_workspace(id[0])) {
            id = [id[0], 0];
        }
        const toplevel = this.forest.find_toplevel(id);
        if (toplevel) {
            const onto = this.forest.largest_window_on(ext, toplevel);
            if (onto) {
                if (this.attach_to_window(ext, onto, win, { cursor: lib.cursor_rect() })) {
                    return;
                }
            }
        }
        this.attach_to_monitor(ext, win, id, ext.settings.smart_gaps());
    }
    auto_tile(ext, win, ignore_focus = false) {
        const result = this.fetch_mode(ext, win, ignore_focus);
        this.detach_window(ext, win.entity);
        if (result.kind == ERR) {
            this.attach_to_workspace(ext, win, ext.workspace_id(win));
        }
        else {
            this.attach_to_window(ext, result.value, win, { cursor: lib.cursor_rect() });
        }
    }
    destroy(ext) {
        for (const [, [fent,]] of this.forest.toplevel) {
            for (const node of this.forest.iter(fent)) {
                if (node.inner.kind === 2) {
                    this.forest.on_detach(node.inner.entity);
                }
                else if (node.inner.kind === 3) {
                    for (const window of node.inner.entities) {
                        this.forest.on_detach(window);
                    }
                }
            }
        }
        for (const stack of this.forest.stacks.values())
            stack.destroy();
        for (const window of ext.windows.values()) {
            window.stack = null;
        }
        this.forest.stacks.truncate(0);
        ext.show_border_on_focused();
    }
    detach_window(ext, win) {
        this.attached.take_with(win, (prev_fork) => {
            const reflow_fork = this.forest.detach(ext, prev_fork, win);
            if (reflow_fork) {
                const fork = reflow_fork[1];
                if (fork.is_toplevel && ext.settings.smart_gaps() && fork.right === null) {
                    let rect = ext.monitor_work_area(fork.monitor);
                    fork.set_area(rect);
                    fork.smart_gapped = true;
                }
                this.tile(ext, fork, fork.area);
            }
            ext.windows.with(win, (info) => info.ignore_detach = false);
        });
    }
    dropped_on_sibling(ext, win) {
        const fork_entity = this.attached.get(win);
        if (fork_entity) {
            const cursor = lib.cursor_rect();
            const fork = this.forest.forks.get(fork_entity);
            if (fork) {
                if (fork.left.inner.kind === 2 && fork.right && fork.right.inner.kind === 2) {
                    if (fork.left.is_window(win)) {
                        const sibling = ext.windows.get(fork.right.inner.entity);
                        if (sibling && sibling.rect().contains(cursor)) {
                            fork.left.inner.entity = fork.right.inner.entity;
                            fork.right.inner.entity = win;
                            this.tile(ext, fork, fork.area);
                            return true;
                        }
                    }
                    else if (fork.right.is_window(win)) {
                        const sibling = ext.windows.get(fork.left.inner.entity);
                        if (sibling && sibling.rect().contains(cursor)) {
                            fork.right.inner.entity = fork.left.inner.entity;
                            fork.left.inner.entity = win;
                            this.tile(ext, fork, fork.area);
                            return true;
                        }
                    }
                }
            }
        }
        return false;
    }
    find_stack(entity) {
        var _a;
        const att = this.attached.get(entity);
        if (att) {
            const fork = this.forest.forks.get(att);
            if (fork) {
                if (fork.left.is_in_stack(entity)) {
                    return [fork, fork.left, true];
                }
                else if ((_a = fork.right) === null || _a === void 0 ? void 0 : _a.is_in_stack(entity)) {
                    return [fork, fork.right, false];
                }
            }
        }
        return null;
    }
    get_parent_fork(window) {
        const entity = this.attached.get(window);
        if (!entity)
            return null;
        return this.forest.forks.get(entity);
    }
    on_drop(ext, win, via_overview = false) {
        const [cursor, monitor] = ext.cursor_status();
        const workspace = ext.active_workspace();
        const attach_mon = () => {
            const workspace_id = [monitor, workspace];
            const toplevel = this.forest.find_toplevel(workspace_id);
            if (toplevel) {
                const attach_to = this.forest.largest_window_on(ext, toplevel);
                if (attach_to) {
                    this.attach_to_window(ext, attach_to, win, { cursor });
                    return;
                }
            }
            this.attach_to_monitor(ext, win, workspace_id, ext.settings.smart_gaps());
        };
        if (via_overview) {
            this.detach_window(ext, win.entity);
            attach_mon();
            return;
        }
        if (this.dropped_on_sibling(ext, win.entity))
            return;
        let attach_to = null;
        for (const found of ext.windows_at_pointer(cursor, monitor, workspace)) {
            if (found != win && this.attached.contains(found.entity)) {
                attach_to = found;
                break;
            }
        }
        this.detach_window(ext, win.entity);
        if (attach_to) {
            this.attach_to_window(ext, attach_to, win, { cursor });
        }
        else {
            attach_mon();
        }
    }
    reflow(ext, win) {
        const fork_entity = this.attached.get(win);
        if (!fork_entity)
            return;
        ext.register_fn(() => {
            const fork = this.forest.forks.get(fork_entity);
            if (fork)
                this.tile(ext, fork, fork.area);
        });
    }
    tile(ext, fork, area) {
        this.forest.tile(ext, fork, area);
    }
    toggle_floating(ext) {
        const focused = ext.focus_window();
        if (!focused)
            return;
        if (ext.contains_tag(focused.entity, Tags.Floating)) {
            ext.delete_tag(focused.entity, Tags.Floating);
            this.auto_tile(ext, focused, false);
        }
        else if (!focused.is_tilable(ext)) {
            if (ext.contains_tag(focused.entity, Tags.ForcedTile)) {
                ext.delete_tag(focused.entity, Tags.ForcedTile);
                const fork_entity = this.attached.get(focused.entity);
                if (fork_entity) {
                    this.detach_window(ext, focused.entity);
                }
            }
            else {
                ext.add_tag(focused.entity, Tags.ForcedTile);
                this.auto_tile(ext, focused, false);
            }
        }
        else {
            const fork_entity = this.attached.get(focused.entity);
            if (fork_entity) {
                this.detach_window(ext, focused.entity);
                ext.add_tag(focused.entity, Tags.Floating);
            }
        }
    }
    toggle_orientation(ext, window) {
        const result = this.toggle_orientation_(ext, window);
        if (result.kind == ERR) {
            log.warn(`toggle_orientation: ${result.value}`);
        }
    }
    toggle_stacking(ext) {
        var _a, _b;
        const focused = ext.focus_window();
        if (!focused)
            return;
        if (ext.contains_tag(focused.entity, Tags.Floating)) {
            ext.delete_tag(focused.entity, Tags.Floating);
            this.auto_tile(ext, focused, false);
        }
        const fork_entity = this.attached.get(focused.entity);
        if (fork_entity) {
            const fork = this.forest.forks.get(fork_entity);
            if (fork) {
                const stack_toggle = (fork, branch) => {
                    var _a;
                    const stack = branch.inner;
                    if (stack.entities.length === 1) {
                        focused.stack = null;
                        (_a = this.forest.stacks.remove(stack.idx)) === null || _a === void 0 ? void 0 : _a.destroy();
                        fork.measure(this.forest, ext, fork.area, this.forest.on_record());
                        return node.Node.window(focused.entity);
                    }
                    return null;
                };
                if (fork.left.is_window(focused.entity)) {
                    focused.stack = this.forest.stacks.insert(new Stack(ext, focused.entity, fork.workspace, fork.monitor));
                    fork.left = node.Node.stacked(focused.entity, focused.stack);
                    fork.measure(this.forest, ext, fork.area, this.forest.on_record());
                }
                else if (fork.left.is_in_stack(focused.entity)) {
                    const node = stack_toggle(fork, fork.left);
                    if (node) {
                        fork.left = node;
                        if (!fork.right) {
                            this.forest.reassign_to_parent(fork, node);
                        }
                    }
                    ;
                }
                else if ((_a = fork.right) === null || _a === void 0 ? void 0 : _a.is_window(focused.entity)) {
                    focused.stack = this.forest.stacks.insert(new Stack(ext, focused.entity, fork.workspace, fork.monitor));
                    fork.right = node.Node.stacked(focused.entity, focused.stack);
                    fork.measure(this.forest, ext, fork.area, this.forest.on_record());
                }
                else if ((_b = fork.right) === null || _b === void 0 ? void 0 : _b.is_in_stack(focused.entity)) {
                    const node = stack_toggle(fork, fork.right);
                    if (node)
                        fork.right = node;
                }
                this.tile(ext, fork, fork.area);
            }
        }
    }
    update_stack(ext, stack) {
        if (stack.rect) {
            const container = this.forest.stacks.get(stack.idx);
            if (container) {
                container.clear();
                for (const entity of stack.entities) {
                    const window = ext.windows.get(entity);
                    if (window) {
                        window.stack = stack.idx;
                        container.add(window);
                    }
                }
                container.update_positions(stack.rect);
                container.auto_activate();
            }
        }
        else {
            log.warn('stack rect was null');
        }
    }
    windows_are_siblings(a, b) {
        const a_parent = this.attached.get(a);
        const b_parent = this.attached.get(b);
        if (a_parent !== null && null !== b_parent && ecs.entity_eq(a_parent, b_parent)) {
            return a_parent;
        }
        return null;
    }
    fetch_mode(ext, win, ignore_focus = false) {
        if (ignore_focus) {
            return Err('ignoring focus');
        }
        if (!ext.prev_focused) {
            return Err('no window has been previously focused');
        }
        let onto = ext.windows.get(ext.prev_focused);
        if (!onto) {
            return Err('no focus window');
        }
        if (ecs.entity_eq(onto.entity, win.entity)) {
            return Err('tiled window and attach window are the same window');
        }
        if (!onto.is_tilable(ext)) {
            return Err('focused window is not tilable');
        }
        if (onto.meta.minimized) {
            return Err('previous window was minimized');
        }
        if (!this.attached.contains(onto.entity)) {
            return Err('focused window is not attached');
        }
        return onto.meta.get_monitor() == win.meta.get_monitor() && onto.workspace_id() == win.workspace_id()
            ? Ok(onto)
            : Err('window is not on the same monitor or workspace');
    }
    toggle_orientation_(ext, focused) {
        if (focused.meta.get_maximized()) {
            return Err('cannot toggle maximized window');
        }
        const fork_entity = this.attached.get(focused.entity);
        if (!fork_entity) {
            return Err(`window is not attached to the tree`);
        }
        const fork = this.forest.forks.get(fork_entity);
        if (!fork) {
            return Err('window\'s fork attachment does not exist');
        }
        if (!fork.right)
            return Ok(void (0));
        fork.toggle_orientation();
        this.forest.measure(ext, fork, fork.area);
        for (const child of this.forest.iter(fork_entity, NodeKind.FORK)) {
            const child_fork = this.forest.forks.get(child.inner.entity);
            if (child_fork) {
                child_fork.rebalance_orientation();
                this.forest.measure(ext, child_fork, child_fork.area);
            }
            else {
                log.error('toggle_orientation: Fork(${child.entity}) does not exist to have its orientation toggled');
            }
        }
        this.forest.arrange(ext, fork.workspace, true);
        return Ok(void (0));
    }
}
//# sourceMappingURL=auto_tiler.js.map