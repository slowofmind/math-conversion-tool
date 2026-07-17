-- embed-images.lua
-- Reads image files from the virtual filesystem and embeds them
-- directly into HTML output, producing standalone pages without
-- needing --embed-resources. This avoids the MathJax conflict
-- since script tags are not touched.
--
-- SVG files are inlined as raw <svg> markup (smaller, scalable,
-- searchable, CSS-stylable). Raster images are base64-encoded
-- as data URIs.
--
-- Only runs for HTML output formats. For docx/epub/etc., pandoc
-- handles image embedding internally, so this filter skips itself.
--
-- Supported raster formats: PNG, JPEG, GIF, WebP, AVIF, BMP
-- Supported vector formats: SVG (inlined as markup)

local mime_types = {
  png  = "image/png",
  jpg  = "image/jpeg",
  jpeg = "image/jpeg",
  gif  = "image/gif",
  webp = "image/webp",
  avif = "image/avif",
  bmp  = "image/bmp",
}

local function get_extension(path)
  return path:match("%.([^%.]+)$")
end

local function is_svg(path)
  local ext = get_extension(path)
  return ext and ext:lower() == "svg"
end

local function get_mime(path)
  local ext = get_extension(path)
  if ext then
    return mime_types[ext:lower()]
  end
  return nil
end

local function read_file(path, mode)
  local f = io.open(path, mode)
  if not f then
    io.stderr:write("[embed-images] File not found: " .. path .. "\n")
    return nil
  end
  local data = f:read("*a")
  f:close()
  if not data or #data == 0 then
    io.stderr:write("[embed-images] Empty file: " .. path .. "\n")
    return nil
  end
  return data
end

local function base64_encode(data)
  if pandoc.base64 then
    return pandoc.base64.encode(data)
  end
  -- Fallback: pure Lua base64 encoder
  local b = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
  return (data:gsub(".", function(x)
    local r, byte = "", x:byte()
    for i = 8, 1, -1 do
      r = r .. (byte % 2^i - byte % 2^(i-1) > 0 and "1" or "0")
    end
    return r
  end) .. "0000"):gsub("%d%d%d?%d?%d?%d?", function(x)
    if #x < 6 then return "" end
    local c = 0
    for i = 1, 6 do
      c = c + (x:sub(i, i) == "1" and 2^(6 - i) or 0)
    end
    return b:sub(c + 1, c + 1)
  end) .. ({"", "==", "="})[#data % 3 + 1]
end

--- Clean up SVG content for inline embedding.
--- Strips XML declarations, doctypes, and processing instructions
--- that are unnecessary when the SVG is embedded in HTML.
local function clean_svg(svg_text)
  -- Remove XML declaration: <?xml ... ?>
  svg_text = svg_text:gsub("<%?xml[^?]*%?>%s*", "")
  -- Remove DOCTYPE
  svg_text = svg_text:gsub("<!DOCTYPE[^>]*>%s*", "")
  -- Remove processing instructions
  svg_text = svg_text:gsub("<%?[^?]*%?>%s*", "")
  return svg_text
end

--- Build an inline SVG wrapped in a <span> with accessibility attributes.
--- The span carries role="img" and aria-label so screen readers
--- announce it like a regular image with alt text.
local function inline_svg(svg_text, alt_text, el)
  svg_text = clean_svg(svg_text)

  -- Build width/height style from image attributes if present
  local style_parts = {}
  local width = el.attr.attributes["width"]
  local height = el.attr.attributes["height"]
  if width then table.insert(style_parts, "width:" .. width) end
  if height then table.insert(style_parts, "height:" .. height) end
  local style_attr = ""
  if #style_parts > 0 then
    style_attr = ' style="' .. table.concat(style_parts, ";") .. '"'
  end

  -- Wrap in a span with role="img" for accessibility
  local aria = ""
  if alt_text and alt_text ~= "" then
    -- Escape quotes in alt text for the attribute
    local escaped_alt = alt_text:gsub('"', '&quot;')
    aria = ' role="img" aria-label="' .. escaped_alt .. '"'
  else
    -- No alt text — mark as decorative
    aria = ' role="img" aria-label=""'
  end

  local html = '<span' .. aria .. style_attr .. '>' .. svg_text .. '</span>'
  return pandoc.RawInline('html', html)
end

function Image(el)
  -- Only embed for HTML output
  if not FORMAT:match("html") then
    return nil
  end

  -- Skip images that are already data URIs or remote URLs
  if el.src:match("^data:") or el.src:match("^https?://") then
    return nil
  end

  -- Get alt text from the image caption
  local alt_text = pandoc.utils.stringify(el.caption)

  -- Handle SVG: inline as raw markup
  if is_svg(el.src) then
    local svg_data = read_file(el.src, "r")
    if not svg_data then return nil end
    return inline_svg(svg_data, alt_text, el)
  end

  -- Handle raster images: base64 data URI
  local mime = get_mime(el.src)
  if not mime then
    io.stderr:write("[embed-images] Skipping unsupported format: " .. el.src .. "\n")
    return nil
  end

  local data = read_file(el.src, "rb")
  if not data then return nil end

  local encoded = base64_encode(data)

  -- Rewrite src to data URI
  el.src = "data:" .. mime .. ";base64," .. encoded
  return el
end
