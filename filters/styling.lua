--[[
  styling.lua  (version 1, 2026-10-05)
  Harvard ATC, Accessible STEM Project

  Puts the stylesheet chosen in the platform's "Styling" drop-down into the
  page, in place of Pandoc's own styles. The platform adds this filter, and
  the chosen stylesheet as a file named atc-style-sheet.css, only when a
  style is chosen. Another file can be named with the metadata field
  atc-style-css.

  What it does to the page:
    1. Reads the stylesheet and puts it in a <style> block at the START of
       the page head extras (header-includes). Anything added later, such as
       the intent filter's toggle-button styles, still comes after it.
       (A header file passed with Pandoc's include-in-header option would
       NOT do: measured on Pandoc 3.11, it replaces what filters add, which
       would silently remove the intent filter's MathJax set-up.)
    2. Switches off Pandoc's built-in document styles (document-css: false).
       Pandoc then keeps only a few small helper rules, plus code-highlight
       colours when there is highlighted code.
    3. Tells the MathJax intent filter that its context-menu fix is not
       needed (mjx-menu-fix: false). The menu bug only happens when a
       stylesheet centres the page body with automatic margins and a maximum
       width; every platform stylesheet is written not to.

  Works for every HTML output, including each page of Chunked HTML. If the
  file cannot be read, the page is left exactly as it was and a warning is
  logged.
]]

local DEFAULT_FILE = 'atc-style-sheet.css'

if not FORMAT:match('html') then
  return {}
end

local function warn(msg)
  if pandoc.log and pandoc.log.warn then
    pandoc.log.warn(msg)
  else
    io.stderr:write('[WARNING] ' .. msg .. '\n')
  end
end

-- Put one HTML block at the front of header-includes, whatever shape the
-- field already has.
local function prepend_header_include(meta, html)
  local block = pandoc.MetaBlocks({ pandoc.RawBlock('html', html) })
  local existing = meta['header-includes']
  if existing == nil then
    meta['header-includes'] = pandoc.MetaList({ block })
  elseif pandoc.utils.type(existing) == 'List' then
    existing:insert(1, block)
    meta['header-includes'] = existing
  else
    meta['header-includes'] = pandoc.MetaList({ block, existing })
  end
end

function Meta(meta)
  local path = DEFAULT_FILE
  if meta['atc-style-css'] ~= nil then
    local p = pandoc.utils.stringify(meta['atc-style-css'])
    if p ~= '' then path = p end
  end

  local f = io.open(path, 'r')
  if not f then
    warn('styling.lua: cannot read ' .. path .. '; page styles left as they were')
    return nil
  end
  local css = f:read('a')
  f:close()

  prepend_header_include(meta, '<style id="atc-style">\n' .. css .. '\n</style>')
  meta['document-css'] = false
  meta['mjx-menu-fix'] = false
  return meta
end
