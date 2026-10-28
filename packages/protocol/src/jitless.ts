import { z } from "zod";

// The page imports this before anything that builds a schema. zod tries `Function("")` as it
// builds its first object schema, to see whether it may compile its parsers; under the page's
// content security policy that fails, and the browser logs a violation on every visit. Parsers
// that are not compiled cost a page nothing it would notice, and the server does not import this.
z.config({ jitless: true });
