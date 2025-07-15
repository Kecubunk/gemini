function xend(rect) {
    return rect.x + rect.width;
}
function xcenter(rect) {
    return rect.x + rect.width / 2;
}
function yend(rect) {
    return rect.y + rect.height;
}
function ycenter(rect) {
    return rect.y + rect.height / 2;
}
function center(rect) {
    return [xcenter(rect), ycenter(rect)];
}
function north(rect) {
    return [xcenter(rect), rect.y];
}
function east(rect) {
    return [xend(rect), ycenter(rect)];
}
function south(rect) {
    return [xcenter(rect), yend(rect)];
}
function west(rect) {
    return [rect.x, ycenter(rect)];
}
function distance([ax, ay], [bx, by]) {
    return Math.sqrt(Math.pow(bx - ax, 2) + Math.pow(by - ay, 2));
}
function directional_distance(a, b, fn_a, fn_b) {
    return distance(fn_a(a), fn_b(b));
}
function window_distance(win_a, win_b) {
    return directional_distance(win_a.get_frame_rect(), win_b.get_frame_rect(), center, center);
}
function upward_distance(win_a, win_b) {
    return directional_distance(win_a.get_frame_rect(), win_b.get_frame_rect(), south, north);
}
function rightward_distance(win_a, win_b) {
    return directional_distance(win_a.get_frame_rect(), win_b.get_frame_rect(), west, east);
}
function downward_distance(win_a, win_b) {
    return directional_distance(win_a.get_frame_rect(), win_b.get_frame_rect(), north, south);
}
function leftward_distance(win_a, win_b) {
    return directional_distance(win_a.get_frame_rect(), win_b.get_frame_rect(), east, west);
}
function shortest_side(origin, rect) {
    let shortest = distance(origin, west(rect));
    shortest = Math.min(shortest, distance(origin, north(rect)));
    shortest = Math.min(shortest, distance(origin, east(rect)));
    return Math.min(shortest, distance(origin, south(rect)));
}
//# sourceMappingURL=geom.js.map