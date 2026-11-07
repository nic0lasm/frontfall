// First: before the schemas are built, so that none is compiled (the page forbids it).
import "@frontfall/protocol/jitless";
import { App } from "./app/app.ts";
import { loadAccessibility } from "./ui/accessibility.ts";

// The page starts here; the app shell (app/app.ts) decides what it shows.
loadAccessibility();
new App().boot();
