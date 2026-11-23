/*
 * The same shell as every page, in a route group of its own, for addresses
 * that only send the reader on (JO-14). Under the (app) group's loading.tsx a
 * redirect streams after the shell, so the browser draws the page, starts
 * fetching the rail's links ahead and then has them cancelled by the move
 * (WebKit reports each as an uncaught error); and a not-found there goes out
 * as a 200. Here, outside that boundary, a redirect is a real 307 before
 * anything is drawn, and a not-found a real 404 in the same shell.
 */
export { default } from "../(app)/layout";
