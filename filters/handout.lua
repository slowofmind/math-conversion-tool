-- handout.lua — Pandoc filter for handout.sty environments
--
-- Usage:
--   pandoc --lua-filter=handout.lua -M handout-mode=problem  input.tex -o out.html
--   pandoc --lua-filter=handout.lua -M handout-mode=sols     input.tex -o out.html
--   pandoc --lua-filter=handout.lua -M handout-mode=solsonly input.tex -o out.html
--
-- Modes:
--   "problem"  — default; show problems, hide solutions
--   "sols"     — show both problems (styled) and solutions
--   "solsonly" — show only solutions

local mode = "problem"  -- default

-- Read mode from document metadata (set via -M handout-mode=...)
function Meta(meta)
  if meta["handout-mode"] then
    mode = pandoc.utils.stringify(meta["handout-mode"])
  end
  return meta
end

-- ---------------------------------------------------------------------------
-- Visibility table: for each environment, which modes show it?
-- ---------------------------------------------------------------------------
local visibility = {
  problem       = { problem = true,  sols = true,  solsonly = false },
  solution      = { problem = false, sols = true,  solsonly = true  },
  problemonly   = { problem = true,  sols = false, solsonly = false },
  solutiononly  = { problem = false, sols = true,  solsonly = true  },
  learningCheck = { problem = true,  sols = false, solsonly = false },
  warmup        = { problem = true,  sols = true,  solsonly = false },
  objectives    = { problem = true,  sols = true,  solsonly = false },
}

-- CSS class applied to the wrapping Div for each environment
local env_class = {
  problem       = "problem",
  solution      = "solution",
  problemonly   = "problem-only",
  solutiononly  = "solution-only",
  learningCheck = "learning-check",
  warmup        = "warmup",
  objectives    = "objectives",
}

-- Environments that get a bold lead-in when rendered (like "Solution.")
local lead_in = {
  solution = "Solution.",
}

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- Match \begin{envname}[optional]...\end{envname} in a raw LaTeX block.
-- Returns envname, optional_arg (or nil), body, or nil if no match.
local function parse_environment(raw)
  -- Try with optional argument first: \begin{env}[opt]body\end{env}
  local env, opt, body = raw:match("^%s*\\begin{([%w@]+)}%[([^%]]*)%](.-)\\end{%1}%s*$")
  if env then return env, opt, body end
  -- Try without optional argument: \begin{env}body\end{env}
  env, body = raw:match("^%s*\\begin{([%w@]+)}(.-)\\end{%1}%s*$")
  if env then return env, nil, body end
  return nil
end

-- Re-parse a LaTeX body string back into Pandoc blocks so its inner content
-- (math, text formatting, nested environments) gets processed normally.
local function latex_to_blocks(latex_source)
  local doc = pandoc.read(latex_source, "latex")
  return doc.blocks
end

-- ---------------------------------------------------------------------------
-- Main: walk RawBlock nodes looking for handout.sty environments
-- ---------------------------------------------------------------------------
function RawBlock(el)
  if el.format ~= "latex" and el.format ~= "tex" then
    return nil  -- not LaTeX, leave alone
  end

  local env, opt, body = parse_environment(el.text)
  if not env then
    return nil  -- not an environment we can parse
  end

  -- Is this an environment we handle?
  local vis = visibility[env]
  if vis == nil then
    return nil  -- unknown environment, leave as raw for other filters or writer
  end

  -- Should it be shown in the current mode?
  if not vis[mode] then
    return {}  -- empty list = delete this block
  end

  -- Recursively parse the body so inner LaTeX is converted normally
  local inner_blocks = latex_to_blocks(body)

  -- Prepend a lead-in if this environment has one (e.g., "Solution.")
  if lead_in[env] then
    local lead = pandoc.Para({
      pandoc.Strong({ pandoc.Str(lead_in[env]) })
    })
    table.insert(inner_blocks, 1, lead)
  end

  -- For `problem` env in sols mode, the original package sets italic font.
  -- We tag with an extra class so CSS can style it.
  local classes = { env_class[env] }
  if env == "problem" and mode == "sols" then
    table.insert(classes, "problem-sols-mode")
  end

  -- Handle the optional argument of `problem[dim]` — the reserved vspace.
  -- In "problem" mode, we'd want to render this as an answer-space div.
  -- In "sols" mode, it's suppressed (matching the original package).
  if env == "problem" and opt and mode == "problem" then
    local space_div = pandoc.Div({}, pandoc.Attr("", {"answer-space"}, {["data-vspace"] = opt}))
    table.insert(inner_blocks, space_div)
  end

  return pandoc.Div(inner_blocks, pandoc.Attr("", classes, {}))
end