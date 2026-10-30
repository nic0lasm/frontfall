import { describe, expect, it } from "vitest";
import { minifyShader } from "../shader-minify.mjs";

describe("minifyShader", () => {
  it("drops comments and joins lines, keeping preprocessor lines on their own", () => {
    const out = minifyShader(`
      precision highp float; // trailing
      /** Doc
       * comment. */
      #ifdef FLAT
        float a = 1.0;
      #else
        float a = 2.0;
      #endif
      void main() {
        outColor = vec4(a);
      }
    `);
    expect(out).toBe(
      [
        "precision highp float;",
        "#ifdef FLAT",
        "float a=1.0;",
        "#else",
        "float a=2.0;",
        "#endif",
        "void main(){outColor=vec4(a);}",
      ].join("\n"),
    );
  });

  it("keeps the spaces that separate words and signs", () => {
    const out = minifyShader("  } else if (a > b) return x - -y;\n  uniform float k ;");
    expect(out).toBe("}else if(a>b)return x - -y;uniform float k;");
  });
});
