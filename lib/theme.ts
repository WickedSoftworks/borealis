/**
 * Screen (dark) and paper (light), chosen per browser.
 *
 * `THEME_SCRIPT` is inlined in the root layout's <head> and applies the choice
 * before the first paint — so a recipient whose system is light never sees the
 * page flash dark first, which is what happened when the dashboard header set
 * the class after hydrating and the share pages never set it at all.
 *
 * In its own module rather than beside the toggle, because the toggle is a
 * client component and a string exported from one reaches a server component
 * as a client reference, not as the string.
 */

export const THEME_STORAGE_KEY = "borealis-register";

/** Runs before paint. Tiny, dependency-free, and wrapped in a try. */
export const THEME_SCRIPT = `(function(){try{var s=localStorage.getItem("${THEME_STORAGE_KEY}");var l=s?s==="light":window.matchMedia("(prefers-color-scheme: light)").matches;if(l)document.documentElement.classList.add("light")}catch(e){}})()`;
