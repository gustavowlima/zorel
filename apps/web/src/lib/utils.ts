import { createCn } from "cn/config"

// Class merging that knows Zorel's own theme tokens (styles.css @theme): without them, "h-control" and "h-auto"
// or "rounded-control" and "rounded-none" don't count as the same property, both stay, and the override loses.
export const cn = createCn({
  extend: {
    theme: {
      spacing: ["control-xs", "control-sm", "control", "control-lg"],
      radius: ["inline", "control", "card", "sheet"]
    }
  }
})
