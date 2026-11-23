/*
 * The same shell as every page, in a route group of its own. The (app) group
 * has a loading.tsx, and anything under a loading boundary streams before it
 * can say "not found", so its 404s go out as 200. Unknown addresses are
 * caught here instead, outside that boundary, and get a real 404 status
 * while still showing the rail, the top bar and a way back.
 */
export { default } from "../(app)/layout";
