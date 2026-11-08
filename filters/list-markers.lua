--[[
List Markers - a Pandoc Lua filter for the Accessible STEM platform (session 296, LISTS-HTML-FILTER-PLAN-s294).

What it does, in plain terms
  The LaTeX preprocessor writes each numbered item's PRINTED marker into the -pp copy as a small tag:
    \ppmark{(c)}         a numbered or lettered item           -> Pandoc: Span, style "color: ppmark"
    \ppmarkown{(x)}      the author's own marker, \item[(x)]   -> Span, style "color: ppmark-own"
    \ppmarkcircled{B.}   a circled correct answer (handout.sty) -> Span, style "color: ppmark-circled"
    \ppmarkcalc{..}      a \calcitem marker (Math Ma): the calculator icon, then the number -> "color: ppmark-calc";
                         the icon arrives as the flagging transform's tag, a "color: ppflag" Span holding the Code
                         "\calculator" (session 299)
  HTML: in a list where EVERY item begins with one of these tags, the browser's own numbers are turned off and each
  item shows the printed marker as text, so a screen reader reads exactly what print shows, once. A \calcitem shows
  the calculator icon before its number, as in print, and the words "(calculator allowed)" after the number, hidden
  from sight but kept in the same line, so a screen reader says "4. (calculator allowed)" - the number first, since
  students move by question number (decision 2026-11-03, "B3 HTML, C Word"). The icon is decorative (alt="").
  Every other list is left as Pandoc makes it (bullets, lists the tool was unsure of, a \calcitem whose \calculator
  is not the icon).
  Word (docx): the tags are removed, and a \calcitem's item text begins with the visible words "(calculator allowed)"
  after Word's own number (form C; Word draws its numbers itself, so the icon has no place before them).
  Every other format (Markdown, plain text, EPUB ...): the tags are removed and nothing else changes, so the output
  equals the preprocessor's earlier "interim" output, where the tags were dropped.

Unticking this filter (decision 2026-11-01, "choice A")
  Without this filter the tags are not removed: HTML shows every marker twice ("c. (c) Use the graphs") and Word
  shows "(c) (c) ...". That is what the preprocessor wrote, shown as it is.
  Tooltip in Pandoc options -> Filters (ticked by default; Default Lists unticked, as a backup - his words 2026-11-03):
    "List Markers: shows each list item's printed marker - (c), (x), a circled answer, the calculator - in the web
     page; in Word a calculator question gets the words "(calculator allowed)"; every other format just loses the
     preprocessor's marker tags. Leave it ticked: unticked, every list marker appears twice."

The look (inline styles only, so nothing depends on a stylesheet): the list has no browser numbers and a left
padding; each marker hangs in that padding, so a wrapped line lines up with the item's text, as in print.
role="list" keeps Safari/VoiceOver calling it a list once list-style is none (known, not measured here).
]]

local TAG = {
  ["color: ppmark"] = "ppmark",
  ["color: ppmark-own"] = "ppmark-own",
  ["color: ppmark-calc"] = "ppmark-calc",
  ["color: ppmark-circled"] = "ppmark-circled",
}
-- kinds this filter shows (ppmark-calc only when its icon is recognised, see calcNumber)
local SHOWN = { ["ppmark"] = true, ["ppmark-own"] = true, ["ppmark-calc"] = true, ["ppmark-circled"] = true }

local LIST_OPEN = '<ol role="list" class="pp-list" style="list-style:none;padding-left:2.5em">'
-- The label is exactly the list's padding wide, so the first line's text starts where wrapped lines do (s296,
-- seen in the browser); a wider marker such as "(viii)" pushes only its own first line right, keeping a gap.
-- The space after the marker sits inside the label, as a no-break space: an ordinary space at the end of an
-- inline-block is dropped, and NVDA in Chrome then read "(a)If" (s296, measured); the no-break space is kept, so
-- screen readers and braille get "(a) If", and it fits inside the label's width.
local GAP = "\u{a0}"
local LABEL_STYLE = "display:inline-block;box-sizing:border-box;min-width:2.5em;padding-right:.5em;margin-left:-2.5em"
-- Words hidden from sight but read by screen readers ("(correct answer)", "(calculator allowed)"): zero-size text kept
-- in the line (s298's form B3). The usual recipe (position:absolute, 1px, clip) made Firefox with NVDA read the words
-- as a line of their own ("C." / "(correct answer)" / the answer); zero-size text read as one line in Chrome and
-- Firefox, screen layout on and off (s298, measured). Not yet heard in VoiceOver or JAWS.
local HIDDEN_STYLE = "font-size:0;color:transparent"

local isHtml = FORMAT:match("html") ~= nil
local isDocx = FORMAT == "docx"

local function tagKind(el)
  if el and el.t == "Span" then return TAG[el.attributes["style"] or ""] end
end

local function isGap(el)
  return el and (el.t == "Space" or el.t == "SoftBreak")
end

-- A Plain or Para holding only tags (and spaces): what Pandoc makes when an item's text starts with a block, such
-- as \item \begin{center} ... (s296, Math Ma exams). With the interim's empty definition there was no such paragraph.
local function onlyTags(b)
  if not (b and (b.t == "Plain" or b.t == "Para")) then return false end
  local any = false
  for _, el in ipairs(b.content) do
    if tagKind(el) then any = true elseif not isGap(el) then return false end
  end
  return any
end

local function unnamedSpan(el)
  if not (el and el.t == "Span" and el.identifier == "" and #el.classes == 0) then return false end
  for _ in pairs(el.attributes) do return false end
  return true
end

-- HTML only, where a label begins the line: skips the spaces after it (from place i), and removes those at the
-- start of an unnamed Span there - Pandoc wraps an author's environment that follows \item in such a Span, often
-- beginning with a space (s296, measured), which would push the first line one space right of the wrapped lines.
-- Returns the place of the first element that is not a space.
local function dropLeadingGaps(inlines, i)
  while isGap(inlines[i]) do i = i + 1 end
  local el = inlines[i]
  if unnamedSpan(el) then
    while isGap(el.content[1]) do el.content:remove(1) end
  end
  return i
end

-- The first Plain or Para a block begins with, looking inside Divs (a center or an author's environment).
local function firstTextBlock(blk)
  if not blk then return nil end
  if blk.t == "Plain" or blk.t == "Para" then return blk end
  if blk.t == "Div" then return firstTextBlock(blk.content[1]) end
  return nil
end

----------------------------------------------------------------------------------------------------------------
-- \calcitem (ppmark-calc), session 299. Its tag holds Math Ma's \calculator - a TikZ drawing Pandoc cannot draw, which
-- the flagging transform hands on as a "color: ppflag" Span holding the Code "\calculator" - then the number.
-- calcNumber returns the number's inlines when the tag is exactly that (one \calculator flag, then text), else nil:
-- any other \calcitem is not recognised and its list stays as Pandoc makes it (its tag removed, as before).
----------------------------------------------------------------------------------------------------------------
local function calcNumber(span)
  local flags, number = 0, pandoc.Inlines({})
  for _, el in ipairs(span.content) do
    if el.t == "Span" and el.attributes["style"] == "color: ppflag" then
      local c = el.content
      if not (#c == 1 and c[1].t == "Code" and c[1].text:match("^%s*\\calculator%s*$")) then return nil end
      flags = flags + 1
    elseif not (#number == 0 and isGap(el)) then
      number:insert(el)
    end
  end
  if flags == 1 and #number > 0 then return number end
end

-- The icon: Math Ma's own \calculator, drawn by pdflatex and turned into SVG (session 297, _work/_s297-calc.svg),
-- carried inside the filter as data so the page needs no separate file (the platform's embed-images filter leaves a
-- data: source alone, and never sees raw HTML). It hangs left of the number, as in print.
local CALC_SVG = "data:image/svg+xml;base64,PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iVVRGLTgiPz4KPHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHhtbG5zOnhsaW5rPSJodHRwOi8vd3d3LnczLm9yZy8xOTk5L3hsaW5rIiB3aWR0aD0iOC4yMjdwdCIgaGVpZ2h0PSIxMC44MDFwdCIgdmlld0JveD0iMCAwIDguMjI3IDEwLjgwMSIgdmVyc2lvbj0iMS4yIj4KPGRlZnM+CjxjbGlwUGF0aCBpZD0iY2xpcDEiPgogIDxwYXRoIGQ9Ik0gMCAwLjM3MTA5NCBMIDcuNTE5NTMxIDAuMzcxMDk0IEwgNy41MTk1MzEgMTAgTCAwIDEwIFogTSAwIDAuMzcxMDk0ICIvPgo8L2NsaXBQYXRoPgo8Y2xpcFBhdGggaWQ9ImNsaXAyIj4KICA8cGF0aCBkPSJNIDAgNyBMIDcuNTE5NTMxIDcgTCA3LjUxOTUzMSA4IEwgMCA4IFogTSAwIDcgIi8+CjwvY2xpcFBhdGg+CjxjbGlwUGF0aCBpZD0iY2xpcDMiPgogIDxwYXRoIGQ9Ik0gMCA1IEwgNy41MTk1MzEgNSBMIDcuNTE5NTMxIDYgTCAwIDYgWiBNIDAgNSAiLz4KPC9jbGlwUGF0aD4KPGNsaXBQYXRoIGlkPSJjbGlwNCI+CiAgPHBhdGggZD0iTSAwIDMgTCA3LjUxOTUzMSAzIEwgNy41MTk1MzEgNCBMIDAgNCBaIE0gMCAzICIvPgo8L2NsaXBQYXRoPgo8L2RlZnM+CjxnIGlkPSJzdXJmYWNlMSI+CjxnIGNsaXAtcGF0aD0idXJsKCNjbGlwMSkiIGNsaXAtcnVsZT0ibm9uemVybyI+CjxwYXRoIHN0eWxlPSJmaWxsOm5vbmU7c3Ryb2tlLXdpZHRoOjAuNzk3MDM7c3Ryb2tlLWxpbmVjYXA6YnV0dDtzdHJva2UtbGluZWpvaW46bWl0ZXI7c3Ryb2tlOnJnYigwJSwwJSwwJSk7c3Ryb2tlLW9wYWNpdHk6MTtzdHJva2UtbWl0ZXJsaW1pdDoxMDsiIGQ9Ik0gMC4wMDAzODgxNzMgMC4wMDA1MDc2ODggTCA2LjQzNTk0MyAwLjAwMDUwNzY4OCBMIDYuNDM1OTQzIDkuMDA4NTc2IEwgMC4wMDAzODgxNzMgOS4wMDg1NzYgWiBNIDAuMDAwMzg4MTczIDAuMDAwNTA3Njg4ICIgdHJhbnNmb3JtPSJtYXRyaXgoMC45MTQxMTEsMCwwLC0wLjkxNDExMSwwLjgxOTk1OCw5LjQyNjI0NSkiLz4KPC9nPgo8cGF0aCBzdHlsZT0iZmlsbDpub25lO3N0cm9rZS13aWR0aDowLjc5NzAzO3N0cm9rZS1saW5lY2FwOmJ1dHQ7c3Ryb2tlLWxpbmVqb2luOm1pdGVyO3N0cm9rZTpyZ2IoMCUsMCUsMCUpO3N0cm9rZS1vcGFjaXR5OjE7c3Ryb2tlLW1pdGVybGltaXQ6MTA7IiBkPSJNIDIuMTQ1NTczIDAuMDAwNTA3Njg4IEwgMi4xNDU1NzMgNi40MzE3OSAiIHRyYW5zZm9ybT0ibWF0cml4KDAuOTE0MTExLDAsMCwtMC45MTQxMTEsMC44MTk5NTgsOS40MjYyNDUpIi8+CjxwYXRoIHN0eWxlPSJmaWxsOm5vbmU7c3Ryb2tlLXdpZHRoOjAuNzk3MDM7c3Ryb2tlLWxpbmVjYXA6YnV0dDtzdHJva2UtbGluZWpvaW46bWl0ZXI7c3Ryb2tlOnJnYigwJSwwJSwwJSk7c3Ryb2tlLW9wYWNpdHk6MTtzdHJva2UtbWl0ZXJsaW1pdDoxMDsiIGQ9Ik0gNC4yOTA3NTggMC4wMDA1MDc2ODggTCA0LjI5MDc1OCA2LjQzMTc5ICIgdHJhbnNmb3JtPSJtYXRyaXgoMC45MTQxMTEsMCwwLC0wLjkxNDExMSwwLjgxOTk1OCw5LjQyNjI0NSkiLz4KPGcgY2xpcC1wYXRoPSJ1cmwoI2NsaXAyKSIgY2xpcC1ydWxlPSJub256ZXJvIj4KPHBhdGggc3R5bGU9ImZpbGw6bm9uZTtzdHJva2Utd2lkdGg6MC43OTcwMztzdHJva2UtbGluZWNhcDpidXR0O3N0cm9rZS1saW5lam9pbjptaXRlcjtzdHJva2U6cmdiKDAlLDAlLDAlKTtzdHJva2Utb3BhY2l0eToxO3N0cm9rZS1taXRlcmxpbWl0OjEwOyIgZD0iTSAwLjAwMDM4ODE3MyAyLjE0NTY5MyBMIDYuNDM1OTQzIDIuMTQ1NjkzICIgdHJhbnNmb3JtPSJtYXRyaXgoMC45MTQxMTEsMCwwLC0wLjkxNDExMSwwLjgxOTk1OCw5LjQyNjI0NSkiLz4KPC9nPgo8ZyBjbGlwLXBhdGg9InVybCgjY2xpcDMpIiBjbGlwLXJ1bGU9Im5vbnplcm8iPgo8cGF0aCBzdHlsZT0iZmlsbDpub25lO3N0cm9rZS13aWR0aDowLjc5NzAzO3N0cm9rZS1saW5lY2FwOmJ1dHQ7c3Ryb2tlLWxpbmVqb2luOm1pdGVyO3N0cm9rZTpyZ2IoMCUsMCUsMCUpO3N0cm9rZS1vcGFjaXR5OjE7c3Ryb2tlLW1pdGVybGltaXQ6MTA7IiBkPSJNIDAuMDAwMzg4MTczIDQuMjkwODc4IEwgNi40MzU5NDMgNC4yOTA4NzggIiB0cmFuc2Zvcm09Im1hdHJpeCgwLjkxNDExMSwwLDAsLTAuOTE0MTExLDAuODE5OTU4LDkuNDI2MjQ1KSIvPgo8L2c+CjxnIGNsaXAtcGF0aD0idXJsKCNjbGlwNCkiIGNsaXAtcnVsZT0ibm9uemVybyI+CjxwYXRoIHN0eWxlPSJmaWxsOm5vbmU7c3Ryb2tlLXdpZHRoOjAuNzk3MDM7c3Ryb2tlLWxpbmVjYXA6YnV0dDtzdHJva2UtbGluZWpvaW46bWl0ZXI7c3Ryb2tlOnJnYigwJSwwJSwwJSk7c3Ryb2tlLW9wYWNpdHk6MTtzdHJva2UtbWl0ZXJsaW1pdDoxMDsiIGQ9Ik0gMC4wMDAzODgxNzMgNi40MzE3OSBMIDYuNDM1OTQzIDYuNDMxNzkgIiB0cmFuc2Zvcm09Im1hdHJpeCgwLjkxNDExMSwwLDAsLTAuOTE0MTExLDAuODE5OTU4LDkuNDI2MjQ1KSIvPgo8L2c+CjwvZz4KPC9zdmc+Cg=="
local ICON_STYLE = "height:1em;width:auto;vertical-align:-0.12em;margin-left:-1.25em;margin-right:.25em"
local CALC_WORDS = "(calculator allowed)"

-- The item's leading tag: its first block is a Plain or Para whose first inline is a tag.
local function leadingTag(item)
  local b = item[1]
  if b and (b.t == "Plain" or b.t == "Para") then
    local k = tagKind(b.content[1])
    if k then return k, b end
  end
end

----------------------------------------------------------------------------------------------------------------
-- Numbered items and the author's own markers (ppmark, ppmark-own)
----------------------------------------------------------------------------------------------------------------
local function markerLabel(kind, content)
  local inner = pandoc.Inlines(content)
  inner:insert(pandoc.Str(GAP))
  return pandoc.Span(inner, { class = "pp-label " .. kind, style = LABEL_STYLE })
end

-- A \calcitem's label (s298's form B3): decorative icon, the number, the hidden words (beginning with a no-break
-- space, as the circled answers'), the label's no-break space.
local function calcLabel(number)
  local inner = pandoc.Inlines({ pandoc.RawInline("html",
    '<img src="' .. CALC_SVG .. '" alt="" class="pp-calc-icon" style="' .. ICON_STYLE .. '">') })
  inner:extend(number)
  inner:insert(pandoc.Span({ pandoc.Str(GAP .. "(calculator"), pandoc.Space(), pandoc.Str("allowed)") },
    { class = "pp-visually-hidden", style = HIDDEN_STYLE }))
  inner:insert(pandoc.Str(GAP))
  return pandoc.Span(inner, { class = "pp-label ppmark-calc", style = LABEL_STYLE })
end

----------------------------------------------------------------------------------------------------------------
-- Circled correct answers (ppmark-circled). Kept apart from the plain markers on purpose (his wish, 2026-11-01):
-- a circle says "this is the correct answer", which carries more meaning than a marker. The letter is drawn in a
-- circle for sight, and the words "(correct answer)" follow it, hidden from sight but read by screen readers (in the
-- line since s299, HIDDEN_STYLE).
----------------------------------------------------------------------------------------------------------------
local CIRCLE_STYLE = "display:inline-block;border:1px solid currentColor;border-radius:50%;padding:0 .25em"

local function circledLabel(content)
  local circle = pandoc.Span(content, { class = "pp-circle", style = CIRCLE_STYLE })
  -- begins with a no-break space too: an ordinary one was dropped, NVDA read "C.(correct answer)" (s296)
  local words = pandoc.Span({ pandoc.Str(GAP), pandoc.Str("(correct"), pandoc.Space(), pandoc.Str("answer)") },
    { class = "pp-visually-hidden", style = HIDDEN_STYLE })
  return pandoc.Span({ circle, words, pandoc.Str(GAP) }, { class = "pp-label pp-circled", style = LABEL_STYLE })
end

----------------------------------------------------------------------------------------------------------------
-- Pass 1 (HTML only): a list the tool marked in full becomes a raw <ol> whose items start with their label.
----------------------------------------------------------------------------------------------------------------
local function markedList(ol)
  for _, item in ipairs(ol.content) do
    local k, b = leadingTag(item)
    if not (k and SHOWN[k]) then return nil end -- rule 1: not every item tagged, so left as Pandoc makes it
    if k == "ppmark-calc" and not calcNumber(b.content[1]) then return nil end -- a \calcitem not recognised
  end
  local out = { pandoc.RawBlock("html", LIST_OPEN) }
  for _, item in ipairs(ol.content) do
    local kind, b = leadingTag(item)
    local span = table.remove(b.content, 1)
    local first = dropLeadingGaps(b.content, 1)
    for _ = 2, first do table.remove(b.content, 1) end
    local blocks = pandoc.List(item)
    -- the tag was alone in its paragraph: drop that paragraph and put the label where the item's text begins, so
    -- the marker stays on the item's first line as in print (if the next block holds no text, it keeps its own line)
    local into = b
    if #b.content == 0 then
      local nextText = firstTextBlock(blocks[2])
      if nextText then blocks:remove(1); into = nextText end
    end
    if #span.content > 0 then -- an empty \item[] prints no marker, so it gets no label
      local lab
      if kind == "ppmark-circled" then lab = circledLabel(span.content)
      elseif kind == "ppmark-calc" then lab = calcLabel(calcNumber(span))
      else lab = markerLabel(kind, span.content) end
      table.insert(into.content, 1, lab)
    end
    out[#out + 1] = pandoc.RawBlock("html", "<li>")
    for _, blk in ipairs(blocks) do out[#out + 1] = blk end
    out[#out + 1] = pandoc.RawBlock("html", "</li>")
  end
  out[#out + 1] = pandoc.RawBlock("html", "</ol>")
  return out
end

----------------------------------------------------------------------------------------------------------------
-- Pass 2 (every format): any tag still there is removed, with the space after it when it began the line or had a
-- space before it - as TeX did with the interim's empty definition.
-- Word (docx) only: a recognised \calcitem tag becomes the visible words "(calculator allowed)" and a space (form C),
-- at the start of the item's text, after Word's own number (s299).
----------------------------------------------------------------------------------------------------------------
local function calcWords()
  return { pandoc.Str("(calculator"), pandoc.Space(), pandoc.Str("allowed)"), pandoc.Space() }
end

-- Word only, before pass 2: an item whose calc tag is alone in its first paragraph ("\calcitem", a blank line, then
-- a block - Math Ma PS07): that paragraph goes and the words begin the item's first text, as the HTML label does and
-- where Word puts the item's number; Word's text is then today's with the words added (s299, measured).
local function calcWordsMoved(ol)
  for _, item in ipairs(ol.content) do
    local b = item[1]
    if onlyTags(b) then
      local calc = false
      for _, el in ipairs(b.content) do if tagKind(el) == "ppmark-calc" and calcNumber(el) then calc = true end end
      local nextText = calc and firstTextBlock(item[2])
      if nextText then
        table.remove(item, 1)
        local i = 1
        while isGap(nextText.content[i]) do i = i + 1 end
        for _ = 2, i do nextText.content:remove(1) end
        for k, w in ipairs(calcWords()) do nextText.content:insert(k, w) end
      end
    end
  end
  return ol
end

local function removeTags(inlines)
  local out, i, changed = {}, 1, false
  while i <= #inlines do
    local el = inlines[i]
    if isDocx and tagKind(el) == "ppmark-calc" and calcNumber(el) then
      changed = true
      for _, w in ipairs(calcWords()) do out[#out + 1] = w end
      while isGap(inlines[i + 1]) do i = i + 1 end -- the words bring their own space
    elseif tagKind(el) then
      changed = true
      -- Not dropLeadingGaps here: whether Pandoc's own output (without tags) has a space there depends on how the
      -- source is laid out (s296: "\item\ppmark{(a)} \begin{problem}..." has it, a line break before the
      -- environment does not), so other formats get exactly the interim's rule.
      if (#out == 0 or isGap(out[#out])) and isGap(inlines[i + 1]) then i = i + 1 end
    else
      out[#out + 1] = el
    end
    i = i + 1
  end
  if changed then return pandoc.Inlines(out) end
end

-- a paragraph that held nothing but tags goes with them (in Word, not one holding a recognised \calcitem tag: its
-- words stay, as a line of their own)
local function dropTagOnly(b)
  if not onlyTags(b) then return end
  if isDocx then
    for _, el in ipairs(b.content) do
      if tagKind(el) == "ppmark-calc" and calcNumber(el) then return end
    end
  end
  return {}
end

local passes = {}
if isHtml then passes[#passes + 1] = { OrderedList = markedList } end
if isDocx then passes[#passes + 1] = { OrderedList = calcWordsMoved } end
passes[#passes + 1] = { Para = dropTagOnly, Plain = dropTagOnly }
passes[#passes + 1] = { Inlines = removeTags }
return passes
