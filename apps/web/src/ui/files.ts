// Opens the system file picker without rendering an <input> (screens stay free of raw controls).
export function pickFiles(options: { multiple?: boolean; accept?: string } = {}): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement("input")
    input.type = "file"
    input.multiple = options.multiple ?? true
    if (options.accept) input.accept = options.accept
    input.addEventListener("change", () => resolve([...(input.files ?? [])]), { once: true })
    input.addEventListener("cancel", () => resolve([]), { once: true })
    input.click()
  })
}
