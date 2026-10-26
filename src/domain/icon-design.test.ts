import { describe, expect, it } from "vitest";
import {
  buildIconDesignPrompt,
  DEFAULT_ICON_VI_PROMPT_TEMPLATE,
  ICON_DESIGN_VARIANTS,
  isIconDesignVariantId
} from "./icon-design";

describe("Icon Design VI rules", () => {
  it("defines four color assets and two layout assets", () => {
    expect(ICON_DESIGN_VARIANTS).toHaveLength(6);
    expect(ICON_DESIGN_VARIANTS.filter((variant) => variant.group === "color")).toHaveLength(4);
    expect(ICON_DESIGN_VARIANTS.filter((variant) => variant.group === "layout")).toHaveLength(2);
    expect(ICON_DESIGN_VARIANTS.find((variant) => variant.id === "layout-horizontal")?.size).toBe(
      "1536x1024"
    );
  });

  it("builds a single-variant prompt with reference order and the feature title", () => {
    const prompt = buildIconDesignPrompt({
      template: DEFAULT_ICON_VI_PROMPT_TEMPLATE,
      featureTitle: "Twin Crispers",
      variantId: "midea-blue"
    });

    // Reference order contract: image 1 is the (single) semantic source symbol,
    // images 2 and later are the dynamically supplied brand guideline references.
    // The slot count is not fixed, so the prompt must not hard-code "image 3".
    expect(prompt).toContain("image 1");
    expect(prompt).toContain("Images 2 and later");
    expect(prompt).toContain("authoritative brand guideline references");
    expect(prompt).toContain("semantic source symbol");
    expect(prompt).not.toContain("image 3");
    expect(prompt).toContain("Twin Crispers");
    expect(prompt).toContain("#0092D8");
    expect(prompt).toContain("exactly one standalone finished artwork");
    expect(prompt).not.toContain("{{FEATURE_TITLE}}");
  });

  it("rejects unknown variants", () => {
    expect(isIconDesignVariantId("layout-vertical")).toBe(true);
    expect(isIconDesignVariantId("poster")).toBe(false);
  });
});