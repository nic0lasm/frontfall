// Shaders ship as text inside the client, so every byte of them is downloaded
// by every player. This shrinks the body of a GLSL template string: comments
// out, lines joined, spaces dropped around punctuation. Names are kept, so a
// shader error in a browser still reads. Preprocessor lines (#ifdef, #define)
// need a line of their own, and stay on one.

// Spaces are dropped around these only. + and - stay spaced (a + +b is not a++b),
// and so do words, which need their spaces (else if, uniform float).
const PUNCTUATION = /\s*([{};,()=<>?:[\]*/!&|])\s*/g;

/**
 * The shader without comments and with its lines joined, its text otherwise unchanged.
 * @param {string} source
 * @returns {string}
 */
export function minifyShader(source) {
  const lines = source
    .replace(/\/\*[^]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .filter((line) => line !== "");
  /** @type {string[]} */
  const out = [];
  let run = "";
  const flush = () => {
    if (run !== "") out.push(run.replace(PUNCTUATION, "$1"));
    run = "";
  };
  for (const line of lines) {
    if (line.startsWith("#")) {
      flush();
      out.push(line);
    } else {
      run += (run === "" ? "" : " ") + line;
    }
  }
  flush();
  return out.join("\n");
}
