--[[
Blanks - a Pandoc Lua filter for the Accessible STEM platform (session 304, BLANKS-FILTER-PLAN-s300 step 4).

What it does, in plain terms
  handout.sty's fill-in-the-blank commands (\fitb, \cfitb, \mfitb, \fitbox, \cfitbox) print a line to write on in a
  problems version and the answer on that line in a solutions version. The LaTeX preprocessor (session 301) writes
  each call as a small tag holding only what this version prints, so a problems version never holds the answer:
    in text       a Span, style "color: ppfitb <blank|answer> <width> <left|center>[ box]", holding the words printed
                  on the line (a blank) or the answer (an answer)
    in a formula  \class{ppfitb <blank|answer> <width> <left|center>[ box]}{<drawing>}, the drawing being
                  \underline{<words>\hspace{<width>}} for a blank and \underline{\boldsymbol{<answer>}} for an answer
                  (\boxed for a framed line, \fitbox and \cfitbox)
  This filter turns the tags into what each format can show (his decision 2026-11-04: "Let's go ahead with the
  visible lighter "blank" everywhere"; marking answers is deferred, so an answer looks as in print):
  Web page (html, html5, chunkedhtml): a blank is a line of the printed width holding any printed words, then the
    word "blank", smaller and grey (#555, contrast 7.5:1; s302's form C). A screen reader says "look for blank as a
    function of blank"; sighted readers see a line as in print, with the word in it. Inside a formula the same is
    drawn by MathJax's \style, so speech gets "y of t equals blank" (the preprocessor's \underline drawing is spoken
    "empty with horizontal bar below", s302). An answer is bold, on the same line.
  Word (docx): a blank is the words, then the word "blank", underlined (framed for \fitbox), grey and 9 point. Inside
    an equation, "blank" is underlined (boxed) but not grey: Word drops colour and \style in equations (s303).
    An answer is bold and underlined (framed), as in print.
  Every other format (Markdown, plain text, EPUB ...): a blank is the words, then "[blank]"; an answer is bold;
    inside a formula the TeX holds the words and \text{[blank]}, with no line and no \hspace (plain text then writes
    "f(x) = [blank] + 1"; it cannot write \underline and would leave the whole formula as TeX code, s304).
  Answers inside formulas keep the preprocessor's drawing in every format; only the \class wrapper goes.
  The filter never adds or removes words of the document: it shows what the tag holds.

Unticking this filter (measured in s300 and s303)
  Text: a solution shows the answer as plain words, a blank shows nothing (no answer, no code). Formulas: the page
  and Word show the preprocessor's drawing (a silent line; the answer bold and underlined); Markdown and plain text
  show the \class code.
  Tooltip, for Pandoc options -> Filters (draft; step 7 puts it in the platform, on his word):
    "Blanks: shows each fill-in-the-blank (\fitb, \cfitb, \fitbox ...) as a line with the word "blank" on it, and a
     solution's answer in bold on its line, in the web page and Word; other formats get "[blank]". Leave it ticked:
     unticked, a blank shows nothing."

The look (inline styles only, so nothing depends on a stylesheet): the line is an inline-block of the printed width
(min-width, so longer words still fit) with a bottom border, or a border all round for a framed one, in the text's own
colour (currentColor; the line has no colour of its own). Widths as written in inches, cm, mm, pt, pc, em, ex, px;
bp as pt; a fraction of \linewidth (\textwidth, \columnwidth, \hsize) as a percentage in text; any other width gets
no minimum (the line fits its words). Not in the tests (s303): html4, chunkedhtml; the grey #555 has no dark-mode
colour (as List Markers' calculator icon); with desktop Pandoc's own MathML instead of MathJax a formula with \style
shows as TeX (so did the preprocessor's \class).
]]

local WORD = "blank"
local LIGHTER = "font-size:.75em;color:#555"            -- s302's form C, on the page and in formulas
local DOCX_LIGHTER = '<w:color w:val="555555"/><w:sz w:val="18"/><w:szCs w:val="18"/>' -- 9 pt; the body is 12 pt
local DOCX_UNDERLINE = '<w:u w:val="single"/>'
local DOCX_FRAME = '<w:bdr w:val="single" w:sz="4" w:space="0" w:color="auto"/>'

local isHtml = FORMAT:match("html") ~= nil
local isDocx = FORMAT == "docx"

----------------------------------------------------------------------------------------------------------------
-- The tag's details: "ppfitb <kind> <width> <align>[ box]"
----------------------------------------------------------------------------------------------------------------
local function readTag(s)
  local f = {}
  for w in s:gmatch("%S+") do f[#f + 1] = w end
  if f[1] ~= "ppfitb" or #f < 4 then return nil end
  local align = (f[4] == "center" or f[4] == "right") and f[4] or "left"
  return { kind = f[2], width = f[3], align = align, box = f[5] == "box" }
end

local function spanTag(el)
  local st = el.attributes["style"]
  if st and st:sub(1, 7) == "color: " then return readTag(st:sub(8)) end
end

local CSS_UNITS = { ["in"] = true, cm = true, mm = true, pt = true, pc = true, em = true, ex = true, px = true }
local LINE_WIDTHS = { ["\\linewidth"] = true, ["\\textwidth"] = true, ["\\columnwidth"] = true, ["\\hsize"] = true }

-- The printed width as CSS, or nil. In a formula no percentage: TeX reads % as a comment.
local function cssWidth(w, inMath)
  local num, unit = w:match("^(%d*%.?%d+)(%a%a)$")
  if num and CSS_UNITS[unit] then return w end
  if num and unit == "bp" then return num .. "pt" end
  if inMath then return nil end
  local frac, name = w:match("^(%d*%.?%d*)(\\%a+)$")
  if frac and LINE_WIDTHS[name] then
    local n = frac == "" and 1 or tonumber(frac)
    if n then return string.format("%g%%", n * 100) end
  end
end

local function lineStyle(tag, inMath)
  local parts = { "display:inline-block" }
  local w = cssWidth(tag.width, inMath)
  if w then parts[#parts + 1] = "min-width:" .. w end
  parts[#parts + 1] = tag.box and "border:1px solid currentColor" or "border-bottom:1px solid currentColor"
  parts[#parts + 1] = "text-align:" .. tag.align
  return table.concat(parts, ";")
end

----------------------------------------------------------------------------------------------------------------
-- Text: the Span
----------------------------------------------------------------------------------------------------------------
local function isGap(el)
  return el and (el.t == "Space" or el.t == "SoftBreak")
end

local function trimGaps(inlines)
  local l = pandoc.Inlines(inlines)
  while isGap(l[1]) do l:remove(1) end
  while isGap(l[#l]) do l:remove(#l) end
  return l
end

-- Word: one run with its own formatting. Pandoc has no colour, size or run border for Word, so these are raw runs.
local function xmlText(s)
  return (s:gsub("&", "&amp;"):gsub("<", "&lt;"):gsub(">", "&gt;"))
end
local function docxRun(text, p)
  local rpr = (p.b and "<w:b/><w:bCs/>" or "") .. (p.i and "<w:i/><w:iCs/>" or "") .. (p.lighter and DOCX_LIGHTER or "") ..
    (p.u and DOCX_UNDERLINE or "") .. (p.frame and DOCX_FRAME or "")
  return pandoc.RawInline("openxml", '<w:r><w:rPr>' .. rpr .. '</w:rPr><w:t xml:space="preserve">' .. xmlText(text) .. '</w:t></w:r>')
end

-- Word: inlines as raw runs with the given formatting, when they are only words (and bold or italic words);
-- nil for anything else (a formula, a link ...), which must stay a Pandoc element.
local function docxRuns(inlines, p)
  local out = {}
  local function walk(list, q)
    for _, el in ipairs(list) do
      if el.t == "Str" then out[#out + 1] = docxRun(el.text, q)
      elseif isGap(el) then out[#out + 1] = docxRun(" ", q)
      elseif el.t == "Strong" or el.t == "Emph" then
        local r = {}
        for k, v in pairs(q) do r[k] = v end
        if el.t == "Strong" then r.b = true else r.i = true end
        if not walk(el.content, r) then return false end
      else
        return false
      end
    end
    return true
  end
  if walk(inlines, p) then return out end
end

local function textBlank(tag, words)
  if isHtml then
    local inner = pandoc.Inlines(words)
    if #inner > 0 then inner:insert(pandoc.Space()) end
    inner:insert(pandoc.Span({ pandoc.Str(WORD) }, { class = "pp-blank-word", style = LIGHTER }))
    return pandoc.Span(inner, { class = "pp-blank", style = lineStyle(tag, false) })
  end
  local out = pandoc.Inlines({})
  if isDocx then
    -- the words are on the line too, as in print; the space before "blank" is on it as well
    if #words > 0 then
      local w = pandoc.Inlines(words)
      w:insert(pandoc.Space())
      local runs = tag.box and docxRuns(w, { frame = true })
      if runs then out:extend(runs) elseif tag.box then out:extend(w) else out:insert(pandoc.Underline(w)) end
    end
    out:insert(docxRun(WORD, { lighter = true, u = not tag.box, frame = tag.box }))
    return out
  end
  out:extend(words)
  if #words > 0 then out:insert(pandoc.Space()) end
  out:insert(pandoc.Str("[" .. WORD .. "]"))
  return out
end

local function textAnswer(tag, answer)
  if isHtml then
    return pandoc.Span({ pandoc.Strong(answer) }, { class = "pp-answer", style = lineStyle(tag, false) })
  end
  if isDocx then
    -- a frame only on plain words; anything else (a formula ...) gets the underline instead
    local runs = tag.box and docxRuns(answer, { b = true, frame = true })
    if runs then return runs end
    return pandoc.Strong({ pandoc.Underline(answer) })
  end
  return pandoc.Strong(answer)
end

local function fitbSpan(el)
  local tag = spanTag(el)
  if not tag then return nil end
  local content = trimGaps(el.content)
  if tag.kind == "answer" and #content > 0 then return textAnswer(tag, content) end
  return textBlank(tag, content)
end

----------------------------------------------------------------------------------------------------------------
-- Formulas: \class{ppfitb ...}{<drawing>} inside the TeX, found by reading the TeX's tokens and braces
----------------------------------------------------------------------------------------------------------------
-- the place after a control sequence starting at i (a backslash): its letters, or one other character
local function csEnd(s, i)
  local j = i + 1
  while s:sub(j, j):match("%a") do j = j + 1 end
  if j == i + 1 then j = i + 2 end
  return j
end

local function skipSpaces(s, i)
  while s:sub(i, i):match("%s") do i = i + 1 end
  return i
end

-- the place of the brace closing the group that opens at i, or nil
local function groupEnd(s, i)
  local depth, j = 0, i
  while j <= #s do
    local ch = s:sub(j, j)
    if ch == "\\" then
      j = j + 2
    else
      if ch == "{" then depth = depth + 1
      elseif ch == "}" then
        depth = depth - 1
        if depth == 0 then return j end
      end
      j = j + 1
    end
  end
end

local function trim(s)
  return (s:gsub("^%s+", ""):gsub("%s+$", ""))
end

-- the drawing's inside, when it is \underline{..} or \boxed{..} and nothing else; nil otherwise
local function drawingInside(d)
  local i = skipSpaces(d, 1)
  if d:sub(i, i) ~= "\\" then return nil end
  local j = csEnd(d, i)
  local name = d:sub(i + 1, j - 1)
  if name ~= "underline" and name ~= "boxed" then return nil end
  local a = skipSpaces(d, j)
  local e = d:sub(a, a) == "{" and groupEnd(d, a)
  if e and skipSpaces(d, e + 1) > #d then return d:sub(a + 1, e - 1) end
end

-- a blank's words: the drawing's inside without the \hspace{<width>} that ends it
local function blankWords(inside)
  local i = 1
  while i <= #inside do
    local ch = inside:sub(i, i)
    if ch == "\\" then
      local j = csEnd(inside, i)
      if inside:sub(i + 1, j - 1) == "hspace" then
        local a = skipSpaces(inside, j)
        local e = inside:sub(a, a) == "{" and groupEnd(inside, a)
        if e and skipSpaces(inside, e + 1) > #inside then return trim(inside:sub(1, i - 1)) end
      end
      i = j
    elseif ch == "{" then
      i = (groupEnd(inside, i) or #inside) + 1
    else
      i = i + 1
    end
  end
  return trim(inside)
end

local function formulaTag(tag, drawing)
  local inside = drawingInside(drawing)
  if tag.kind == "answer" or not inside then
    -- an answer as the preprocessor draws it; an unknown drawing kept whole, as one group
    return inside and drawing or "{" .. drawing .. "}"
  end
  local words = blankWords(inside)
  if isHtml then
    -- a group between the two \style: written directly inside each other, MathJax puts both styles on one element
    -- and the line turns grey (s303, _s303-probe.txt H1/H2)
    return "\\style{" .. lineStyle(tag, true) .. "}{" .. words .. "{\\style{" .. LIGHTER .. "}{\\text{" .. WORD .. "}}}}"
  end
  if isDocx then return (tag.box and "\\boxed{" or "\\underline{") .. words .. "\\text{" .. WORD .. "}}" end
  -- other formats: "[blank]" as in text, with no line; plain text writes \underline{..} as TeX code (s304)
  return words .. "\\text{[" .. WORD .. "]}"
end

local function rewriteTex(tex)
  local out, i, from = {}, 1, 1
  while i <= #tex do
    if tex:sub(i, i) == "\\" then
      local j = csEnd(tex, i)
      local whole = nil
      if tex:sub(i + 1, j - 1) == "class" then
        local a = skipSpaces(tex, j)
        local ae = tex:sub(a, a) == "{" and groupEnd(tex, a)
        local tag = ae and readTag(tex:sub(a + 1, ae - 1))
        local b = tag and skipSpaces(tex, ae + 1)
        local be = b and tex:sub(b, b) == "{" and groupEnd(tex, b)
        if be then
          out[#out + 1] = tex:sub(from, i - 1)
          out[#out + 1] = formulaTag(tag, rewriteTex(tex:sub(b + 1, be - 1)))
          whole = be + 1
          from = whole
        end
      end
      i = whole or j
    else
      i = i + 1
    end
  end
  out[#out + 1] = tex:sub(from)
  return table.concat(out)
end

local function fitbMath(el)
  if not el.text:find("ppfitb", 1, true) then return nil end
  local tex = rewriteTex(el.text)
  if tex ~= el.text then
    el.text = tex
    return el
  end
end

return { { Span = fitbSpan, Math = fitbMath } }
