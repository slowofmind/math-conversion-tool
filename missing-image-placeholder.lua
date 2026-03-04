-- missing-image-placeholder.lua
-- Replaces Image elements with visible placeholder text when the
-- referenced image file is not available in the virtual filesystem.
-- Useful for browser-based pandoc conversions where images may not
-- be uploaded alongside the source document.

function Image(el)
  -- Try to read the image file; if it fails, it's missing
  local f = io.open(el.src, "r")
  if f then
    f:close()
    return nil  -- image exists, leave it alone
  end

  -- Build placeholder content
  local warning = pandoc.Str("⚠ Missing image: " .. el.src)
  local caption_text = pandoc.utils.stringify(el.caption)

  local blocks = {}
  table.insert(blocks, pandoc.Para({
    pandoc.Strong({ pandoc.Str("["), warning, pandoc.Str("]") })
  }))

  if caption_text ~= "" then
    table.insert(blocks, pandoc.Para({
      pandoc.Emph({ pandoc.Str("Caption: " .. caption_text) })
    }))
  end

  -- Wrap in a Div with a border style (works in HTML; in docx the
  -- text itself is the main indicator)
  local div = pandoc.Div(blocks, pandoc.Attr("", {"missing-image-placeholder"}, {
    {"style", "border: 2px dashed #c0392b; padding: 12px; margin: 12px 0; background: #fdf2f2; color: #c0392b; text-align: center;"}
  }))

  return div
end
