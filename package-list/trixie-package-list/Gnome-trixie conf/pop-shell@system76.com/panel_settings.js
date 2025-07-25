const Me = imports.misc.extensionUtils.getCurrentExtension();
const Utils = Me.imports.utils;
const { Clutter, Gio, St } = imports.gi;
const { PopupBaseMenuItem, PopupMenuItem, PopupSwitchMenuItem, PopupSeparatorMenuItem } = imports.ui.popupMenu;
const { Button } = imports.ui.panelMenu;
const GLib = imports.gi.GLib;
var Indicator = class Indicator {
    constructor(ext) {
        this.button = new Button(0.0, _("Pop Shell Settings"));
        ext.button = this.button;
        ext.button_gio_icon_auto_on = Gio.icon_new_for_string(`${Me.path}/icons/pop-shell-auto-on-symbolic.svg`);
        ext.button_gio_icon_auto_off = Gio.icon_new_for_string(`${Me.path}/icons/pop-shell-auto-off-symbolic.svg`);
        let button_icon_auto_on = new St.Icon({
            gicon: ext.button_gio_icon_auto_on,
            style_class: "system-status-icon",
        });
        let button_icon_auto_off = new St.Icon({
            gicon: ext.button_gio_icon_auto_off,
            style_class: "system-status-icon",
        });
        if (ext.settings.tile_by_default()) {
            this.button.icon = button_icon_auto_on;
        }
        else {
            this.button.icon = button_icon_auto_off;
        }
        this.button.add_actor(this.button.icon);
        let bm = this.button.menu;
        bm.addMenuItem(tiled(ext));
        bm.addMenuItem(floating_window_exceptions(ext, bm));
        bm.addMenuItem(menu_separator(''));
        bm.addMenuItem(shortcuts(bm));
        bm.addMenuItem(settings_button(bm));
        bm.addMenuItem(menu_separator(''));
        if (!Utils.is_wayland()) {
            bm.addMenuItem(show_title(ext));
        }
        bm.addMenuItem(toggle(_("Show Active Hint"), ext.settings.active_hint(), (toggle) => {
            ext.settings.set_active_hint(toggle.state);
        }));
        bm.addMenuItem(color_selector(ext, bm));
        bm.addMenuItem(number_entry(_("Gaps"), ext.settings.gap_inner(), (value) => {
            ext.settings.set_gap_inner(value);
            ext.settings.set_gap_outer(value);
        }));
    }
    destroy() {
        this.button.destroy();
    }
}
function menu_separator(text) {
    return new PopupSeparatorMenuItem(text);
}
function settings_button(menu) {
    let item = new PopupMenuItem(_('View All'));
    item.connect('activate', () => {
        let path = GLib.find_program_in_path('pop-shell-shortcuts');
        if (path) {
            imports.misc.util.spawn([path]);
        }
        else {
            imports.misc.util.spawn(['xdg-open', 'https://support.system76.com/articles/pop-keyboard-shortcuts/']);
        }
        menu.close();
    });
    item.label.get_clutter_text().set_margin_left(12);
    return item;
}
function floating_window_exceptions(ext, menu) {
    let label = new St.Label({ text: "Floating Window Exceptions" });
    label.set_x_expand(true);
    let icon = new St.Icon({ icon_name: "go-next-symbolic", icon_size: 16 });
    let widget = new St.BoxLayout({ vertical: false });
    widget.add(label);
    widget.add(icon);
    widget.set_x_expand(true);
    let base = new PopupBaseMenuItem();
    base.add_child(widget);
    base.connect('activate', () => {
        ext.exception_dialog();
        GLib.timeout_add(GLib.PRIORITY_LOW, 300, () => {
            menu.close();
            return false;
        });
    });
    return base;
}
function shortcuts(menu) {
    let layout_manager = new Clutter.GridLayout({ orientation: Clutter.Orientation.HORIZONTAL });
    let widget = new St.Widget({ layout_manager, x_expand: true });
    let item = new PopupBaseMenuItem();
    item.add_child(widget);
    item.connect('activate', () => {
        let path = GLib.find_program_in_path('pop-shell-shortcuts');
        if (path) {
            imports.misc.util.spawn([path]);
        }
        else {
            imports.misc.util.spawn(['xdg-open', 'https://support.system76.com/articles/pop-keyboard-shortcuts/']);
        }
        menu.close();
    });
    function create_label(text) {
        return new St.Label({ text });
    }
    function create_shortcut_label(text) {
        let label = create_label(text);
        label.set_x_align(Clutter.ActorAlign.END);
        return label;
    }
    layout_manager.set_row_spacing(12);
    layout_manager.set_column_spacing(30);
    layout_manager.attach(create_label(_('Shortcuts')), 0, 0, 2, 1);
    [
        [_('Launcher'), _('Super + /')],
        [_('Navigate Windows'), _('Super + Arrow Keys')],
        [_('Toggle Tiling'), _('Super + Y')],
    ].forEach((section, idx) => {
        let key = create_label(section[0]);
        key.get_clutter_text().set_margin_left(12);
        let val = create_shortcut_label(section[1]);
        layout_manager.attach(key, 0, idx + 1, 1, 1);
        layout_manager.attach(val, 1, idx + 1, 1, 1);
    });
    return item;
}
function clamp(input) {
    return Math.min(Math.max(0, input), 128);
}
function number_entry(label, value, callback) {
    let entry = new St.Entry({ text: String(value) });
    entry.set_input_purpose(Clutter.InputContentPurpose.NUMBER);
    entry.set_x_align(Clutter.ActorAlign.END);
    entry.set_x_expand(false);
    entry.set_style_class_name('pop-shell-gaps-entry');
    entry.connect('button-release-event', () => {
        return true;
    });
    let text = entry.clutter_text;
    text.set_max_length(3);
    entry.connect('key-release-event', (_, event) => {
        const symbol = event.get_key_symbol();
        const number = symbol == 65293
            ? parse_number(text.text)
            : symbol == 65361
                ? clamp(parse_number(text.text) - 1)
                : symbol == 65363
                    ? clamp(parse_number(text.text) + 1)
                    : null;
        if (number !== null) {
            text.set_text(String(number));
        }
    });
    let plus_button = new St.Icon();
    plus_button.set_icon_name('value-increase');
    plus_button.set_icon_size(16);
    plus_button.connect('button-press-event', (_, event) => {
        event.get_key_symbol();
        let value = parseInt(text.get_text());
        value = clamp(value + 1);
        text.set_text(String(value));
    });
    let minus_button = new St.Icon();
    minus_button.set_icon_name('value-decrease');
    minus_button.set_icon_size(16);
    minus_button.connect('button-press-event', (_, event) => {
        event.get_key_symbol();
        let value = parseInt(text.get_text());
        value = clamp(value - 1);
        text.set_text(String(value));
    });
    entry.set_secondary_icon(plus_button);
    entry.set_primary_icon(minus_button);
    text.connect('text-changed', () => {
        const input = text.get_text();
        let parsed = parseInt(input);
        if (isNaN(parsed)) {
            text.set_text(input.substr(0, input.length - 1));
            parsed = 0;
        }
        callback(parsed);
    });
    let item = new PopupMenuItem(label);
    item.label.get_clutter_text().set_x_expand(true);
    item.label.set_y_align(Clutter.ActorAlign.CENTER);
    item.add_child(entry);
    return item;
}
function parse_number(text) {
    let number = parseInt(text, 10);
    if (isNaN(number)) {
        number = 0;
    }
    return number;
}
function show_title(ext) {
    const t = toggle(_("Show Window Titles"), ext.settings.show_title(), (toggle) => {
        ext.settings.set_show_title(toggle.state);
    });
    return t;
}
function toggle(desc, active, connect) {
    let toggle = new PopupSwitchMenuItem(desc, active);
    toggle.label.set_y_align(Clutter.ActorAlign.CENTER);
    toggle.connect('toggled', () => {
        connect(toggle);
        return true;
    });
    return toggle;
}
function tiled(ext) {
    let t = toggle(_("Tile Windows"), null != ext.auto_tiler, () => ext.toggle_tiling());
    ext.tiling_toggle_switch = t;
    return t;
}
function color_selector(ext, menu) {
    let color_selector_item = new PopupMenuItem('Active Hint Color');
    let color_button = new St.Button();
    let settings = ext.settings;
    let selected_color = settings.hint_color_rgba();
    color_button.label = "           ";
    color_button.set_style(`background-color: ${selected_color}; border: 2px solid lightgray; border-radius: 2px`);
    settings.ext.connect('changed', (_, key) => {
        if (key === 'hint-color-rgba') {
            let color_value = settings.hint_color_rgba();
            color_button.set_style(`background-color: ${color_value}; border: 2px solid lightgray; border-radius: 2px`);
        }
    });
    color_button.set_x_align(Clutter.ActorAlign.END);
    color_button.set_x_expand(false);
    color_selector_item.label.get_clutter_text().set_x_expand(true);
    color_selector_item.label.set_y_align(Clutter.ActorAlign.CENTER);
    color_selector_item.add_child(color_button);
    color_button.connect('button-press-event', () => {
        let path = Me.dir.get_path() + "/color_dialog/main.js";
        let resp = GLib.spawn_command_line_async(`gjs ${path}`);
        if (!resp) {
            return null;
        }
        GLib.timeout_add(GLib.PRIORITY_LOW, 300, () => {
            menu.close();
            return false;
        });
    });
    return color_selector_item;
}
//# sourceMappingURL=panel_settings.js.map